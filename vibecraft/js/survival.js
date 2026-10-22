'use strict';
// Survival rules: health, hunger, saturation, exhaustion, air and damage. All values are in game ticks
// (20 per second) and follow the reference game's FoodData / LivingEntity behaviour unless noted.
(function (root) {
  const BC = root.BC;

  const DIFFICULTY = ['Peaceful', 'Easy', 'Normal', 'Hard'];
  const MAX_AIR = 300;
  const EXHAUST = { sprintPerBlock: 0.1, swimPerBlock: 0.01, jump: 0.05, sprintJump: 0.2, mine: 0.005, attack: 0.1, damage: 0.1, heal: 6 };

  function newStats() {
    // An optional `hungerFx` (ticks left of the Hunger effect, from raw chicken or mire flesh) is added when eaten.
    return { health: 20, food: 20, saturation: 5, exhaustion: 0, foodTimer: 0, air: MAX_AIR, hurtTime: 0, invuln: 0, lastHurt: 0, peacefulTimer: 0 };
  }
  function addExhaustion(s, x) { s.exhaustion = Math.min(s.exhaustion + x, 40); }

  // One tick of hunger/regeneration. `hurt(amount, cause)` is called for starvation.
  function foodTick(s, difficulty, hurt) {
    // Hunger effect: 0.005 exhaustion per tick per level (reference MobEffects.HUNGER).
    if (s.hungerFx > 0) { s.hungerFx--; addExhaustion(s, 0.005); }
    if (s.exhaustion > 4) {
      s.exhaustion -= 4;
      if (s.saturation > 0) s.saturation = Math.max(s.saturation - 1, 0);
      else if (difficulty > 0) s.food = Math.max(s.food - 1, 0);
    }
    const hurtNow = s.health > 0 && s.health < 20;
    if (s.saturation > 0 && hurtNow && s.food >= 20) {
      if (++s.foodTimer >= 10) { const f = Math.min(s.saturation, 6); heal(s, f / 6); addExhaustion(s, f); s.foodTimer = 0; }
    } else if (s.food >= 18 && hurtNow) {
      if (++s.foodTimer >= 80) { heal(s, 1); addExhaustion(s, EXHAUST.heal); s.foodTimer = 0; }
    } else if (s.food <= 0) {
      if (++s.foodTimer >= 80) {
        if (s.health > 10 || difficulty >= 3 || (s.health > 1 && difficulty === 2)) hurt(1, 'starve');
        s.foodTimer = 0;
      }
    } else s.foodTimer = 0;
    // Peaceful: health and hunger refill on their own.
    if (difficulty === 0) {
      s.peacefulTimer++;
      if (s.peacefulTimer % 20 === 0 && hurtNow) heal(s, 1);
      if (s.peacefulTimer % 10 === 0 && s.food < 20) s.food++;
    }
  }
  function heal(s, n) { if (s.health > 0) s.health = Math.min(20, s.health + n); }

  // Damage with the reference game's invulnerability window: for 10 ticks after a hit only damage
  // above the previous hit applies (and only the difference). Returns the damage actually applied.
  // `reduce(delta)` optionally lowers the part that gets through (armor), as LivingEntity.actuallyHurt does
  // after the invulnerability check, which compares the unreduced amounts.
  function applyDamage(s, amount, exhaustion, reduce) {
    if (amount <= 0 || s.health <= 0) return 0;
    let dealt;
    if (s.invuln > 10) {
      if (amount <= s.lastHurt) return 0;
      dealt = amount - s.lastHurt; s.lastHurt = amount;
    } else {
      dealt = amount; s.lastHurt = amount; s.invuln = 20; s.hurtTime = 10;
    }
    if (reduce) dealt = Math.max(0, reduce(dealt));
    s.health = Math.max(0, s.health - dealt);
    addExhaustion(s, exhaustion == null ? EXHAUST.damage : exhaustion);
    return dealt;
  }
  function tickTimers(s) { if (s.invuln > 0) s.invuln--; if (s.hurtTime > 0) s.hurtTime--; }

  // Air: drains 1 per tick with eyes underwater; at -20 it resets to 0 and deals 2 drowning damage.
  function airTick(s, eyesInWater, hurt) {
    if (eyesInWater) {
      s.air--;
      if (s.air <= -20) { s.air = 0; hurt(2, 'drown'); }
    } else s.air = Math.min(MAX_AIR, s.air + 4);
  }

  // Current Java rule (since about 1.21.5, confirmed in 26.3): floor(distance − 3), so falls under 4 blocks are harmless.
  const fallDamage = dist => Math.max(0, Math.floor(dist + 1e-6 - 3));
  function canEat(s, food, creative) { return !!food && (creative || s.food < 20); }
  // Eating. `rand` rolls a food's side effect (raw chicken: Hunger 30 s at 30 %, mire flesh 80 %).
  function eat(s, food, rand) {
    s.food = Math.min(20, s.food + food.hunger);
    s.saturation = Math.min(s.food, s.saturation + food.saturation);
    const fx = food.effect;
    if (fx && fx.type === 'hunger' && (rand || Math.random)() < fx.chance) s.hungerFx = Math.max(s.hungerFx | 0, Math.round(fx.seconds * 20));
  }
  const canSprint = (s, creative) => creative || s.food > 6;

  // Hunger cost of taking damage, per cause. The reference game charges 0.1 for most sources and nothing
  // for falling, drowning, starving or the void.
  const DAMAGE_EXHAUSTION = { fall: 0, drown: 0, starve: 0, void: 0, cactus: 0.1, mob: 0.1, arrow: 0.1, fire: 0 };
  const DEATH_MESSAGES = {
    fall: 'hit the ground too hard', drown: 'drowned', starve: 'starved to death', cactus: 'was pricked to death',
    void: 'fell out of the world', generic: 'died', mob: 'were slain by {mob}', arrow: 'were shot by {mob}',
  };
  // Causes that armor reduces. The reference tags fall, drowning, starvation, the void, fire ticks and /kill with
  // bypasses_armor; mob attacks, arrows and cactus are reduced.
  const ARMORED = { mob: true, arrow: true, cactus: true };

  // ---------------------------------------------------------------- combat (reference 26.3, see REFERENCE-NOTES 2.4, 2.7, 2.8)
  // Damage from a living, non-player attacker scales with difficulty before armor:
  // Peaceful 0, Easy min(d / 2 + 1, d), Normal d, Hard d * 1.5.
  function scaleDamage(d, difficulty) {
    if (difficulty === 0) return 0;
    if (difficulty === 1) return Math.min(d / 2 + 1, d);
    if (difficulty === 3) return d * 1.5;
    return d;
  }
  // CombatRules.getDamageAfterAbsorb: real = clamp(armor - damage / (2 + toughness / 4), 0.2 * armor, 20),
  // damage * (1 - real / 25).
  function armorReduce(damage, armor, toughness) {
    if (!(armor > 0) || damage <= 0) return damage;
    const t = toughness || 0;
    const real = Math.min(20, Math.max(armor * 0.2, armor - damage / (2 + t / 4)));
    return damage * (1 - real / 25);
  }
  // Every worn piece loses max(1, floor(damage / 4)) durability per hit it absorbs (LivingEntity.hurtArmor).
  const armorWear = damage => Math.max(1, Math.floor(damage / 4));
  // Attack cooldown: delay = 20 / attack speed ticks; strength s = clamp((ticks since swing + 0.5) / delay, 0, 1);
  // damage = base * (0.2 + 0.8 s^2). A fist has speed 4 and damage 1.
  const attackDelay = speed => 20 / (speed || 4);
  const attackStrength = (ticks, speed) => Math.min(1, Math.max(0, (ticks + 0.5) / attackDelay(speed)));
  const attackDamage = (base, strength) => base * (0.2 + 0.8 * strength * strength);
  // Critical hit (x1.5): full strength (s > 0.9), falling (fall distance > 0, not on the ground), not in water,
  // not flying, not sprinting.
  function isCrit(p) { return p.strength > 0.9 && p.fallDist > 0 && !p.onGround && !p.inWater && !p.flying && !p.sprinting; }
  const CRIT = 1.5;
  // Knockback (LivingEntity.knockback) in blocks per tick: horizontal velocity halves and is pushed by `strength`
  // away from the attacker; on the ground the vertical velocity becomes min(0.4, vy / 2 + strength).
  function knockback(v, strength, dx, dz, onGround) {
    const len = Math.hypot(dx, dz);
    if (strength <= 0 || len < 1e-6) return v;
    const nx = dx / len, nz = dz / len;
    return { x: v.x / 2 + nx * strength, y: onGround ? Math.min(0.4, v.y / 2 + strength) : v.y, z: v.z / 2 + nz * strength };
  }
  // Tools used as weapons wear by 2 per hit, swords by 1 (reference item components since 1.20.5).
  const weaponWear = tool => (!tool || tool.type === 'armor' ? 0 : tool.type === 'sword' ? 1 : 2);

  BC.survival = {
    DIFFICULTY, MAX_AIR, EXHAUST, DAMAGE_EXHAUSTION, DEATH_MESSAGES, ARMORED, newStats, addExhaustion, foodTick, heal, applyDamage, tickTimers, airTick, fallDamage, canEat, eat, canSprint,
    scaleDamage, armorReduce, armorWear, attackDelay, attackStrength, attackDamage, isCrit, CRIT, knockback, weaponWear,
  };
})(typeof window !== 'undefined' ? window : globalThis);
