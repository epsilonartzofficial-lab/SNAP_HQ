'use strict';
// Survival rules: health, hunger, saturation, exhaustion, air and damage. All values are in game ticks
// (20 per second) and follow the reference game's FoodData / LivingEntity behaviour unless noted.
(function (root) {
  const BC = root.BC;

  const DIFFICULTY = ['Peaceful', 'Easy', 'Normal', 'Hard'];
  const MAX_AIR = 300;
  const EXHAUST = { sprintPerBlock: 0.1, swimPerBlock: 0.01, jump: 0.05, sprintJump: 0.2, mine: 0.005, attack: 0.1, damage: 0.1, heal: 6 };

  function newStats() {
    return { health: 20, food: 20, saturation: 5, exhaustion: 0, foodTimer: 0, air: MAX_AIR, hurtTime: 0, invuln: 0, lastHurt: 0, peacefulTimer: 0 };
  }
  function addExhaustion(s, x) { s.exhaustion = Math.min(s.exhaustion + x, 40); }

  // One tick of hunger/regeneration. `hurt(amount, cause)` is called for starvation.
  function foodTick(s, difficulty, hurt) {
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
  function applyDamage(s, amount, exhaustion) {
    if (amount <= 0 || s.health <= 0) return 0;
    let dealt;
    if (s.invuln > 10) {
      if (amount <= s.lastHurt) return 0;
      dealt = amount - s.lastHurt; s.lastHurt = amount;
    } else {
      dealt = amount; s.lastHurt = amount; s.invuln = 20; s.hurtTime = 10;
    }
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

  const fallDamage = dist => Math.max(0, Math.ceil(dist - 3));
  function canEat(s, food, creative) { return !!food && (creative || s.food < 20); }
  function eat(s, food) {
    s.food = Math.min(20, s.food + food.hunger);
    s.saturation = Math.min(s.food, s.saturation + food.saturation);
  }
  const canSprint = (s, creative) => creative || s.food > 6;

  // Hunger cost of taking damage, per cause. The reference game charges 0.1 for most sources and nothing
  // for falling, drowning, starving or the void.
  const DAMAGE_EXHAUSTION = { fall: 0, drown: 0, starve: 0, void: 0, cactus: 0.1 };
  const DEATH_MESSAGES = {
    fall: 'hit the ground too hard', drown: 'drowned', starve: 'starved to death', cactus: 'was pricked to death',
    void: 'fell out of the world', generic: 'died',
  };

  BC.survival = { DIFFICULTY, MAX_AIR, EXHAUST, DAMAGE_EXHAUSTION, DEATH_MESSAGES, newStats, addExhaustion, foodTick, heal, applyDamage, tickTimers, airTick, fallDamage, canEat, eat, canSprint };
})(typeof window !== 'undefined' ? window : globalThis);
