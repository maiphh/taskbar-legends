/* Taskbar Legends — management-window prototype. Self-contained. */
(function () {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  const SPRITE = {
    ew1:[31,50], ew2:[55,90], ew3:[34,52], fw:[43,49], hk1:[51,55], hk2:[44,52],
    hu1:[40,52], hu2:[46,52], mh1:[41,56], mh2:[32,51], mh3:[56,49], mk1:[25,52],
    mk2:[31,53], mw1:[30,52], mw2:[34,52], mw3:[37,52], priest:[36,52], wiz:[36,52],
  };
  const ENEMY = { 'fire-worm':[55,45], 'flying-eye':[65,50], goblin:[48,52], skeleton:[49,55] };

  const ROLES = {
    tank:    { hp:300, atk:14, def:40 },
    warrior: { hp:200, atk:22, def:20 },
    ranger:  { hp:140, atk:18, def:10 },
    mage:    { hp:120, atk:30, def:5  },
    support: { hp:150, atk:10, def:10 },
  };
  const RARITY_MULT = { common:1, rare:1.15, epic:1.35, legendary:1.6 };
  const RATES = { common:0.5, rare:0.33, epic:0.13, legendary:0.04 };
  // v14 rules are ON by default since config 1.4.2 (main is at 1.4.5). A normal build shows all three meters.
  const RULES = { recruitPity: true, gearFortune: true };
  const FAMILY_LABEL = {
    guardian:'Guardian', bruiser:'Bruiser', meleeDps:'Melee DPS',
    rangedDps:'Ranged DPS', aoeDps:'AoE DPS', healer:'Healer', bufferDebuffer:'Buffer / Debuffer',
  };
  const TURN_SPD = (combatRole, tags) =>
    combatRole === 'support' ? 115 : combatRole === 'tank' ? 90 : (tags.includes('melee') ? 100 : 105);

  const HEROES = [
    { id:'mw2', name:'Medieval Warrior 2', short:'Warrior 2', catalog:'tank', rarity:'common', starter:true, mod:{},
      family:'guardian', role:'tank', tags:['guardian','melee'],
      basic:{ name:'Guardian Strike', text:'Melee strike, coefficient 1.' },
      signature:{ name:'Guardian Shield', mana:60, text:'Raises a self-shield equal to 15% of max HP for 5s when threatened or below 90% HP. Auto-casts on its next turn when ready.' },
      passive:{ name:'Intercept', text:'Intercepts an attack within range 260. 8s cooldown.' },
      strength:'Raises a self-shield when threatened or hurt', weakness:'Slow, low sustained damage' },
    { id:'hu1', name:'Huntress 1', short:'Huntress 1', catalog:'ranger', rarity:'common', starter:true, mod:{},
      family:'rangedDps', role:'dps', tags:['ranged','single-target'],
      basic:{ name:'Ranger Shot', text:'Ranged shot, coefficient 1.' },
      signature:{ name:'Piercing Shot', mana:60, text:'A strong single-target shot (coefficient 1.8). Auto-casts on its next turn when ready.' },
      passive:{ name:'Fourth Shot', text:'Every fourth basic deals 20% bonus damage.' },
      strength:'Strong single-target burst', weakness:'Limited area damage' },
    { id:'wiz', name:'Wizard', short:'Wizard', catalog:'mage', rarity:'common', starter:true, mod:{},
      family:'aoeDps', role:'dps', tags:['ranged','aoe'],
      basic:{ name:'Arcane Bolt', text:'Magic bolt, coefficient 1.' },
      signature:{ name:'Fireball', mana:80, text:'A fireball (coefficient 1.4) that splashes nearby foes (0.6, radius 48). Auto-casts on its next turn when ready.' },
      passive:{ name:'Third Shot Splash', text:'Every third basic splashes for 35% in radius 32.' },
      strength:'Cluster clearing', weakness:'Lower single-target rate and low defense' },
    { id:'mw1', name:'Medieval Warrior 1', short:'Warrior 1', catalog:'warrior', rarity:'common', starter:false, mod:{},
      family:'meleeDps', role:'dps', tags:['melee','cleave'],
      basic:{ name:'Cleave Strike', text:'Melee strike, coefficient 1.' },
      signature:{ name:'Cleave', mana:60, text:'Cleave the main target (1.5) and one nearby foe (0.6, radius 48). Auto-casts on its next turn when ready.' },
      passive:{ name:'Same-Target Ramp', text:'Repeated hits on the same target ramp +5% each, cap 15%.' },
      strength:'Reliable cleave and sustained focus', weakness:'Must reach the frontline' },
    { id:'mw3', name:'Medieval Warrior 3', short:'Warrior 3', catalog:'warrior', rarity:'common', starter:false, mod:{ hp:1.1, atk:0.95 },
      family:'meleeDps', role:'dps', tags:['melee','cleave'],
      basic:{ name:'Wide Cleave Strike', text:'Melee strike, coefficient 0.9.' },
      signature:{ name:'Wide Cleave', mana:80, text:'A wider cleave (1.3) plus one nearby foe (0.75, radius 64). Auto-casts on its next turn when ready.' },
      passive:{ name:'Same-Target Ramp', text:'Repeated hits on the same target ramp +5% each, cap 15%.' },
      strength:'Wider cleave', weakness:'Less focused damage' },
    { id:'mh1', name:'Martial Hero 1', short:'Martial 1', catalog:'warrior', rarity:'common', starter:false, mod:{ hp:0.9 },
      family:'meleeDps', role:'dps', tags:['melee','single-target'],
      basic:{ name:'Duelist Strike', text:'Melee strike, coefficient 1.' },
      signature:{ name:'Focused Burst', mana:60, text:'A heavy single-target burst (coefficient 2). Auto-casts on its next turn when ready.' },
      passive:{ name:'Same-Target Ramp', text:'Repeated hits on the same target ramp +5% each, cap 20%.' },
      strength:'Boss dueling', weakness:'No multi-target active' },
    { id:'hk1', name:'Hero Knight 1', short:'Hero Knight 1', catalog:'tank', rarity:'rare', starter:false, mod:{},
      family:'bruiser', role:'tank', tags:['bruiser','melee'],
      basic:{ name:'Bruiser Strike', text:'Melee strike, coefficient 1.' },
      signature:{ name:'Second Wind', mana:60, text:'Heals the self for 15% when below 65% HP. Auto-casts on its next turn when ready.' },
      passive:{ name:'Fourth Self-Heal', text:'Every fourth basic heals the self (coefficient 0.3).' },
      strength:'Self-sustaining frontline', weakness:'Less ally protection' },
    { id:'mh2', name:'Martial Hero 2', short:'Martial 2', catalog:'warrior', rarity:'rare', starter:false, mod:{},
      family:'meleeDps', role:'dps', tags:['melee','single-target'],
      basic:{ name:'Duelist Strike', text:'Melee strike, coefficient 1.' },
      signature:{ name:'Quick Burst', mana:40, text:'A shorter single-target burst (coefficient 1.6, 4s charge). Auto-casts on its next turn when ready.' },
      passive:{ name:'Same-Target Ramp', text:'Repeated hits on the same target ramp +5% each, cap 10%.' },
      strength:'Frequent short bursts', weakness:'Lower peak and long-ramp damage' },
    { id:'hu2', name:'Huntress 2', short:'Huntress 2', catalog:'ranger', rarity:'rare', starter:false, mod:{},
      family:'rangedDps', role:'dps', tags:['ranged','single-target'],
      basic:{ name:'Long-Range Shot', text:'Ranged shot, coefficient 0.85, range 320.' },
      signature:{ name:'Long Shot', mana:60, text:'A long-range burst shot (coefficient 1.7). Auto-casts on its next turn when ready.' },
      passive:{ name:'Fourth Shot', text:'Every fourth basic deals 20% bonus damage.' },
      strength:'Long basic-attack range with a strong shot', weakness:'Limited area damage and lower throughput' },
    { id:'ew1', name:'Evil Wizard 1', short:'Evil Wizard 1', catalog:'mage', rarity:'rare', starter:false, mod:{},
      family:'bufferDebuffer', role:'support', tags:['debuffer','ranged'],
      basic:{ name:'Hex Bolt', text:'Magic bolt, coefficient 0.7.' },
      signature:{ name:'Withering Hex', mana:60, text:'Weakens a foe: −20% ATK and −25% DEF for 4s. Auto-casts on its next turn when ready.' },
      passive:{ name:'First Weaken Shield', text:'The first weaken also shields an ally for 6% of max HP for 3s.' },
      strength:'Reduces enemy attack and defense', weakness:'No direct damage spike' },
    { id:'priest', name:'Priest', short:'Priest', catalog:'support', rarity:'rare', starter:false, mod:{},
      family:'healer', role:'support', tags:['healer','ranged'],
      basic:{ name:'Heal / Bolt', text:'Heals an ally (1.2) or bolts a foe (0.7) if everyone is healthy.' },
      signature:{ name:'Restoration', mana:60, text:'Emergency burst heal (coefficient 1.8) when an ally is below 80% HP. Auto-casts on its next turn when ready.' },
      passive:{ name:'Heal Guard', text:'Heals also grant a 10% guard for 2s.' },
      strength:'Repeatable healing plus emergency burst', weakness:'Low damage when the party is hurt' },
    { id:'hk2', name:'Hero Knight 2', short:'Hero Knight 2', catalog:'tank', rarity:'epic', starter:false, mod:{},
      family:'guardian', role:'tank', tags:['guardian','melee'],
      basic:{ name:'Guardian Strike', text:'Melee strike, coefficient 1.' },
      signature:{ name:'Bulwark', mana:60, text:'Raises a self-shield equal to 20% of max HP for 5s when threatened or below 90% HP. Auto-casts on its next turn when ready.' },
      passive:{ name:'Intercept', text:'Intercepts an attack within range 320. 10s cooldown.' },
      strength:'Self-shields when threatened or hurt', weakness:'Longer skill charge than basic fighters' },
    { id:'mk1', name:'Medieval King 1', short:'King 1', catalog:'warrior', rarity:'epic', starter:false, mod:{ hp:1.1 },
      family:'bufferDebuffer', role:'support', tags:['buffer','ranged'],
      basic:{ name:'Banner Bolt', text:'Magic bolt, coefficient 0.7.' },
      signature:{ name:'Rally', mana:60, text:'Boosts the strongest ally’s attack by 15% for 4s. Auto-casts on its next turn when ready.' },
      passive:{ name:'Living Banner', text:'A standing aura that reduces incoming damage by 5%.' },
      strength:'Boosts the strongest ally’s attack', weakness:'Limited damage contribution' },
    { id:'fw', name:'Fantasy Warrior', short:'Fantasy Warrior', catalog:'warrior', rarity:'epic', starter:false, mod:{ atk:1.1, hp:0.95 },
      family:'bruiser', role:'dps', tags:['bruiser','melee','self-sustain'],
      basic:{ name:'Bruiser Strike', text:'Melee strike, coefficient 1.' },
      signature:{ name:'Blood Strike', mana:60, text:'A self-sustaining burst (coefficient 1.2) that also heals the self (0.08). Auto-casts on its next turn when ready.' },
      passive:{ name:'Fourth Basic Guard', text:'Every fourth basic grants a 10% guard for 2s.' },
      strength:'Self-sustaining frontline DPS', weakness:'Lower damage and ally protection' },
    { id:'ew2', name:'Evil Wizard 2', short:'Evil Wizard 2', catalog:'mage', rarity:'epic', starter:false, mod:{},
      family:'aoeDps', role:'dps', tags:['ranged','aoe'],
      basic:{ name:'Arcane Bolt', text:'Magic bolt, coefficient 0.8.' },
      signature:{ name:'Inferno', mana:80, text:'A wide fireball (1.2) that splashes in radius 72 (0.75). Auto-casts on its next turn when ready.' },
      passive:{ name:'Third Shot Splash', text:'Every third basic splashes for 35% in radius 32.' },
      strength:'Large clustered waves', weakness:'Weak isolated-target burst' },
    { id:'mk2', name:'Medieval King 2', short:'King 2', catalog:'tank', rarity:'legendary', starter:false, mod:{ atk:1.15 },
      family:'guardian', role:'tank', tags:['guardian','melee'],
      basic:{ name:'Guardian Strike', text:'Melee strike, coefficient 1.' },
      signature:{ name:'Iron Wall', mana:80, text:'Raises a large self-shield equal to 25% of max HP for 5s when threatened or below 90% HP. Auto-casts on its next turn when ready.' },
      passive:{ name:'Intercept', text:'Intercepts an attack within range 260. 6s cooldown.' },
      strength:'Large self-shield', weakness:'Slow attack and limited damage' },
    { id:'mh3', name:'Martial Hero 3', short:'Martial 3', catalog:'warrior', rarity:'legendary', starter:false, mod:{},
      family:'meleeDps', role:'dps', tags:['melee','single-target'],
      basic:{ name:'Duelist Strike', text:'Melee strike, coefficient 1.' },
      signature:{ name:'Execution', mana:80, text:'A heavy single-target burst (coefficient 2.2). Auto-casts on its next turn when ready.' },
      passive:{ name:'Same-Target Ramp', text:'Repeated hits on the same target ramp +5% each, cap 20%.' },
      strength:'Large single-target burst', weakness:'Long active downtime, no cleave' },
    { id:'ew3', name:'Evil Wizard 3', short:'Evil Wizard 3', catalog:'mage', rarity:'legendary', starter:false, mod:{ },
      family:'bufferDebuffer', role:'support', tags:['debuffer','ranged'],
      basic:{ name:'Hex Bolt', text:'Magic bolt, coefficient 0.65.' },
      signature:{ name:'Armor Break', mana:60, text:'Weakens a foe: −20% ATK and −40% DEF for 3s. Auto-casts on its next turn when ready.' },
      passive:{ name:'First Weaken Shield', text:'The first weaken also shields an ally for 6% of max HP for 3s.' },
      strength:'Defense-breaking burst windows', weakness:'Lower prevention uptime' },
  ];
  const BY_ID = Object.fromEntries(HEROES.map(h => [h.id, h]));

  // Demo save: 9 owned, gold 4280, 16 tickets, mid chapter 1, 8 pulls since last Epic+.
  const OWNED_SEED = {
    mw2:{ level:12, stars:2, xp:1800, locked:true },
    hu1:{ level:12, stars:1, xp:900, locked:false },
    wiz:{ level:11, stars:1, xp:400, locked:false },
    mw1:{ level:8, stars:1, xp:200, locked:false },
    priest:{ level:8, stars:1, xp:120, locked:false },
    hk1:{ level:9, stars:1, xp:600, locked:false },
    mk2:{ level:7, stars:1, xp:80, locked:true },
    ew1:{ level:8, stars:1, xp:220, locked:false },
    mh1:{ level:7, stars:1, xp:60, locked:false },
  };

  const SLOTS = ['FRONT','MIDDLE','REAR'];
  const GEAR_BASE = {
    weapon:{ atk:16 },
    armor:{ hp:80, def:10 },
    charm:null,
  };

  function makeItem(id, slot, rarity, level, stage, stats, equipped, locked) {
    return { id, slot, rarity, level, dropStage: stage, stats, equipped, locked };
  }
  const ITEMS = [
    makeItem('w1','weapon','rare',4,4,{ atk:22 },'mw2',false),
    makeItem('a1','armor','common',3,2,{ hp:96, def:12 },'mw2',false),
    makeItem('c1','charm','rare',2,5,{ hpPct:0.06 },'mw2',false),
    makeItem('w2','weapon','common',3,3,{ atk:18 },'hu1',false),
    makeItem('a2','armor','common',2,1,{ hp:88, def:11 },'hu1',false),
    makeItem('w3','weapon','common',2,2,{ atk:17 },'wiz',false),
    makeItem('a3','armor','rare',3,6,{ hp:110, def:14 },'hk1',false),
    makeItem('w4','weapon','legendary',1,7,{ atk:28 },'mk2',true),
    makeItem('c2','charm','epic',2,7,{ atkPct:0.08 },'mk2',false),
    makeItem('a4','armor','rare',2,5,{ hp:104, def:13 },'priest',false),
    makeItem('w5','weapon','rare',1,4,{ atk:19 },'ew1',false),
    makeItem('c3','charm','common',1,3,{ speedPct:0.04 },'mh1',false),
    makeItem('w6','weapon','epic',2,6,{ atk:24 },null,false),
    makeItem('a5','armor','epic',1,7,{ hp:120, def:15 },null,false),
    makeItem('c4','charm','rare',1,5,{ atkPct:0.05 },null,true),
    makeItem('w7','weapon','common',1,1,{ atk:16 },null,false),
    makeItem('a6','armor','common',1,1,{ hp:80, def:10 },null,false),
    makeItem('c5','charm','common',1,2,{ hpPct:0.04 },null,false),
  ];

  const STAGES = [];
  for (let c = 1; c <= 2; c++) {
    for (let i = 1; i <= 10; i++) {
      const id = `${c}-${i}`;
      const isBoss = i === 10;
      STAGES.push({
        id, chapter:c, index:(c-1)*10+i, isBoss,
        firstClearTickets: c === 1 ? 1 : (i === 10 ? 1 : 2),
        timeoutSec: isBoss ? (c === 1 ? 22 : 21) : 90,
        waves: 3,
      });
    }
  }

  const state = {
    size: 1280,
    screen: 'home',
    detailId: 'mw2',
    gold: 4280,
    tickets: 16,
    party: { FRONT:'mw2', MIDDLE:'hu1', REAR:'wiz' },
    owned: { ...Object.fromEntries(Object.entries(OWNED_SEED).map(([k,v]) => [k, { ...v }])) },
    items: ITEMS.map(i => ({ ...i, stats:{ ...i.stats } })),
    filters: { role:'all', rarity:'all', sort:'rarity' },
    gearFilter: { slot:'all', rarity:'all' },
    selectedGear: 'w1',
    formPick: null,
    equipHero: 'mw2',
    equipSlot: 'weapon',
    equipItem: null,
    equipFrom: 'detail',
    stageId: '1-7',
    cleared: new Set(['1-1','1-2','1-3','1-4','1-5','1-6']),
    chapter: 1,
    progression: 'PUSHING',
    pityEpic: 8,           // pulls since last epic+
    pityLegend: 8,
    pityNew: 2,            // 6 new in 8 pulls, last 2 were dupes
    fortune: 14,           // gear legendary every 100
    history: [
      { id:'mw1', rarity:'common', dupe:false },
      { id:'priest', rarity:'rare', dupe:false },
      { id:'hk1', rarity:'rare', dupe:false },
      { id:'mw2', rarity:'common', dupe:true },
      { id:'mk2', rarity:'legendary', dupe:false },
      { id:'ew1', rarity:'rare', dupe:false },
      { id:'mh1', rarity:'common', dupe:false },
      { id:'hu1', rarity:'common', dupe:true },
    ],
    settings: {
      paused:false, muted:false,
      volume:80, music:70, sfx:80, ui:60,
      zoom:1, placement:'free',
    },
    banner: 'standard',
  };

  function fmt(n) { return n.toLocaleString('en-US'); }
  function title(s) { return s.replace(/\b\w/g, c => c.toUpperCase()); }
  function hero(id) { return BY_ID[id]; }
  function isOwned(id) { return !!state.owned[id]; }
  function itemById(id) { return state.items.find(i => i.id === id); }
  function equipped(heroId, slot) { return state.items.find(i => i.equipped === heroId && i.slot === slot) || null; }

  function statsOf(id, loadout) {
    const h = hero(id), o = state.owned[id];
    if (!h || !o) return null;
    const base = ROLES[h.catalog];
    const rm = RARITY_MULT[h.rarity];
    const hm = (s) => h.mod[s] ?? 1;
    const growth = (1 + 0.1 * (o.level - 1)) * (1 + 0.12 * (o.stars - 1));
    let hp = Math.round(base.hp * rm * hm('hp') * growth);
    let atk = Math.round(base.atk * rm * hm('atk') * growth);
    let def = Math.round(base.def * rm * hm('def') * growth);
    const flats = { hp:0, atk:0, def:0 };
    let hpPct=0, atkPct=0, speedPct=0;
    for (const slot of ['weapon','armor','charm']) {
      const it = loadout ? (loadout[slot] || null) : equipped(id, slot);
      if (!it) continue;
      if (it.stats.hp) flats.hp += it.stats.hp;
      if (it.stats.atk) flats.atk += it.stats.atk;
      if (it.stats.def) flats.def += it.stats.def;
      if (it.stats.hpPct) hpPct += it.stats.hpPct;
      if (it.stats.atkPct) atkPct += it.stats.atkPct;
      if (it.stats.speedPct) speedPct += it.stats.speedPct;
    }
    hp = Math.round((hp + flats.hp) * (1 + hpPct));
    atk = Math.round((atk + flats.atk) * (1 + atkPct));
    def = Math.round(def + flats.def);
    return { hp, atk, def, turn: TURN_SPD(h.role, h.tags), speedPct };
  }

  // Official gearScore (economy.ts): hp*0.2 + atk*4 + def*2 + (pct sum)*100, times (1 + 0.1*level) on *base* stats.
  // Prototype items store already-scaled display stats, so the level term is already in the roll.
  const GEAR_POWER = { hp:0.2, atk:4, def:2, secondary:100 };
  const GEAR_RARITY_MULT = { common:1, rare:1.1, epic:1.2, legendary:1.3 };
  function gearScore(item) {
    if (!item) return 0;
    const s = item.stats || {};
    return ((s.hp||0)*GEAR_POWER.hp + (s.atk||0)*GEAR_POWER.atk + (s.def||0)*GEAR_POWER.def
      + ((s.hpPct||0)+(s.atkPct||0)+(s.speedPct||0))*GEAR_POWER.secondary);
  }
  function upgradeCost(item) {
    if (!item) return 0;
    return Math.round(90 * Math.pow(1.06, (item.dropStage||1) - 1) * GEAR_RARITY_MULT[item.rarity] * Math.pow(item.level + 1, 1.4));
  }
  function rarityShape(rarity) {
    return `<img class="shape-cue" src="assets/ui/shape-${rarity}.png" alt="" draggable="false">`;
  }
  function slotIcon(slot) {
    return slot === 'weapon' ? 'sword' : slot === 'armor' ? 'armor' : 'potion';
  }
  function ownedRoster() {
    return HEROES.filter(h => isOwned(h.id));
  }
  function currentLoadout(heroId) {
    return {
      weapon: equipped(heroId, 'weapon'),
      armor: equipped(heroId, 'armor'),
      charm: equipped(heroId, 'charm'),
    };
  }
  function loadoutWith(heroId, slot, item) {
    const lo = currentLoadout(heroId);
    lo[slot] = item || null;
    return lo;
  }
  function spdLabel(st) {
    if (!st) return '—';
    if (st.speedPct) return `${Math.round(st.turn * (1 + st.speedPct))} +${Math.round(st.speedPct*100)}%`;
    return String(st.turn);
  }
  function spdValue(st) {
    if (!st) return 0;
    return st.speedPct ? Math.round(st.turn * (1 + st.speedPct)) : st.turn;
  }
  function openEquip(heroId, slot, itemId, from) {
    if (!isOwned(heroId)) return;
    state.equipHero = heroId;
    state.detailId = heroId;
    state.equipSlot = slot || 'weapon';
    state.equipItem = itemId || null;
    state.equipFrom = from || (state.screen === 'formation' ? 'formation' : 'detail');
    goto('equip');
  }
  function cycleEquip(dir) {
    const list = ownedRoster();
    if (!list.length) return;
    const i = Math.max(0, list.findIndex(h => h.id === state.equipHero));
    const next = list[(i + dir + list.length) % list.length];
    state.equipHero = next.id;
    state.detailId = next.id;
    // keep slot; drop a selection that is not in this slot list (all stash items of the slot remain valid)
    render();
  }

  function scaleFit(natW, natH, maxW, maxH) {
    return Math.max(1, Math.min(Math.floor(maxW / natW), Math.floor(maxH / natH)));
  }
  // Shared integer scales: cards 2x, busts 3x/2x, detail 4x/2x, banner 3x/2x.
  const SCALE = { card: 2, bust1280: 3, bust960: 2, detail1280: 4, detail960: 2, banner1280: 3, banner960: 2, reveal: 4 };
  function sprite(id, scale, opts = {}) {
    const [w,h] = SPRITE[id];
    const s = scale;
    const cls = opts.locked ? ' is-sil' : '';
    return `<img class="${cls}" src="assets/heroes/${id}.png" alt="${opts.alt || ''}" width="${w*s}" height="${h*s}" style="width:${w*s}px;height:${h*s}px" draggable="false">`;
  }
  function enemySprite(id, maxW, maxH) {
    const [w,h] = ENEMY[id];
    const s = scaleFit(w, h, maxW, maxH);
    return `<img src="assets/enemies/${id}.png" alt="" width="${w*s}" height="${h*s}" style="width:${w*s}px;height:${h*s}px" draggable="false">`;
  }
  function stars(n) {
    const filled = Math.max(0, Math.min(6, n || 0));
    const glyphs = [];
    for (let i = 0; i < 6; i++) glyphs.push(`<span class="star${i < filled ? ' is-on' : ''}">★</span>`);
    return `<span class="star-row" aria-label="${filled} of 6 stars">${glyphs.join('')}</span>`;
  }
  function escapeAttr(s) {
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  }
  function combatBadge(h) {
    return `<span class="badge ${h.role}">${h.role.toUpperCase()}</span>`;
  }
  function rarityTag(h) {
    return `<span class="rarity-tag ${h.rarity}">${h.rarity}</span>`;
  }
  function roleBadges(h) {
    // Compact surfaces: combat role + rarity only. No element slot. No catalog here.
    return combatBadge(h) + rarityTag(h);
  }
  function catalogLine(h) {
    return `<p class="catalog-line">${title(h.catalog)} · ${FAMILY_LABEL[h.family] || title(h.family)}</p>`;
  }
  function compactName(h, extra = '') {
    return `<span class="name${extra ? ' ' + extra : ''}" data-fit-name title="${escapeAttr(h.name)}">${h.short}</span>`;
  }
  function pullOdds(rarity) {
    const n = HEROES.filter(h => h.rarity === rarity).length;
    const pct = (RATES[rarity] / n) * 100;
    return pct.toFixed(2) + '%';
  }
  function rosterComplete() {
    return Object.keys(state.owned).length >= HEROES.length;
  }
  function fitNames() {
    const canvas = fitNames._c || (fitNames._c = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    $$('[data-fit-name]').forEach(el => {
      el.classList.remove('is-small');
      const parent = el.parentElement;
      if (!parent) return;
      const cs = getComputedStyle(parent);
      const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const avail = Math.floor(parent.clientWidth - pad);
      if (avail <= 0) return;
      ctx.font = '12px Galmuri11, monospace';
      if (Math.ceil(ctx.measureText(el.textContent).width) > avail) el.classList.add('is-small');
    });
  }
  function toast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.add('is-on');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.classList.remove('is-on'); el.hidden = true; }, 2200);
  }
  const DEMO = {
    PUSHING: { stageId:'1-7', cleared:['1-1','1-2','1-3','1-4','1-5','1-6'], chapter:1, progression:'PUSHING' },
    BOSS_READY: { stageId:'1-10', cleared:['1-1','1-2','1-3','1-4','1-5','1-6','1-7','1-8','1-9'], chapter:1, progression:'BOSS_READY' },
  };
  function setDemo(mode) {
    const d = DEMO[mode] || DEMO.PUSHING;
    state.stageId = d.stageId;
    state.cleared = new Set(d.cleared);
    state.chapter = d.chapter;
    state.progression = d.progression;
    $$('.js-prog').forEach(b => b.classList.toggle('is-on', b.dataset.prog === (DEMO[mode] ? mode : 'PUSHING')));
    if (state.screen) render();
  }
  function stageStatus(stage) {
    const id = stage.id;
    if (state.progression === 'FARMING') return `Farming ${id}`;
    if (state.progression === 'BOSS_READY') return `Boss ${id} ready, click to fight`;
    if (state.progression === 'BOSS_FIGHT') return `Boss ${id}!`;
    return `Pushing ${id}`;
  }
  function xpNext(level) { return Math.round(4000 * Math.pow(level, 1.3)); }

  function setSize(n) {
    state.size = n;
    document.body.dataset.size = String(n);
    $$('.js-size').forEach(b => b.classList.toggle('is-on', Number(b.dataset.size) === n));
    $('#sizeLabel').textContent = n === 1280 ? '1280 × 720  (16:9 preset)' : '960 × 640  (3:2 preset)';
    if (state.screen) { render(); }
  }

  function goto(screen, detailId) {
    if (detailId) state.detailId = detailId;
    state.screen = screen;
    $$('.nav-btn').forEach(b => {
      const on = b.dataset.nav === screen;
      b.classList.toggle('is-on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    // Hero detail and Equip are pushes, not tabs.
    if (screen === 'detail' || screen === 'equip') {
      const tab = (screen === 'equip' && state.equipFrom === 'formation') ? 'formation' : 'heroes';
      $$('.nav-btn').forEach(b => {
        const on = b.dataset.nav === tab;
        b.classList.toggle('is-on', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
    }
    $$('.screen').forEach(s => s.classList.toggle('is-on', s.dataset.screen === screen));
    document.body.dataset.screen = screen;
    render();
  }

  function wallet() {
    $('#goldVal').textContent = fmt(state.gold);
    $('#tixVal').textContent = String(state.tickets);
  }

  /* ---------- screens ---------- */
  function renderHome() {
    const stage = STAGES.find(s => s.id === state.stageId);
    const party = SLOTS.map(slot => {
      const id = state.party[slot];
      const h = hero(id), o = state.owned[id], st = statsOf(id);
      const sc = state.size === 1280 ? SCALE.bust1280 : SCALE.bust960;
      return `<button type="button" class="party-bust panel-inner" data-open-hero="${id}">
        <span class="muted">${slot}</span>
        <span class="art well">${sprite(id, sc)}</span>
        ${compactName(h, 'name-bust')}
        ${stars(o.stars)}
        ${combatBadge(h)}
        ${state.size===1280?`<span class="muted">Lv ${o.level} · HP ${fmt(st.hp)}</span>`:''}
      </button>`;
    }).join('');
    $('#home-party').innerHTML = party;
    const bossReady = state.progression === 'BOSS_READY';
    $('#home-stage').innerHTML = `
      <h3>Current stage</h3>
      <p class="gold" style="font:700 24px/24px Galmuri11,monospace;margin:8px 0;">Stage ${stage.id}</p>
      <p>${stageStatus(stage)}</p>
      <p class="muted">${stage.waves} waves · ${stage.timeoutSec}s timer · first clear ${stage.firstClearTickets} ticket${stage.firstClearTickets>1?'s':''}. Chapter ${stage.chapter}.</p>
      <div class="row home-actions${bossReady?' is-boss':''}" style="margin-top:12px;flex-wrap:wrap;">
        ${bossReady ? '<button type="button" class="btn cta" data-act="fight-boss"><img src="assets/ui/icon-skull.png" width="16" height="16" alt="">Fight boss</button>' : '<button type="button" class="btn lg primary" data-goto="stages">Open Stages</button>'}
        <button type="button" class="btn${bossReady?'':' lg'}" data-goto="formation">Edit formation</button>
        ${bossReady ? '<button type="button" class="btn" data-goto="stages">Open Stages</button>' : ''}
      </div>`;
    $('#home-side').innerHTML = `
      <div class="panel-inner">
        <h3>Offline progress</h3>
        <p>Farm 1-6 · ~1,240 gold/h · ~800 XP/h per hero</p>
        <p class="muted">Cap 8 hours · next chest after 1h 20m. Partial gold, XP, tickets, and chest progress carry across visits.</p>
      </div>
      <div class="panel-inner">
        <h3>Roster</h3>
        <p>${Object.keys(state.owned).length} / ${HEROES.length} heroes owned</p>
        <p class="muted">Epic+ in ${30-state.pityEpic}${RULES.recruitPity ? ` · Legend in ${60-state.pityLegend}` : ''} · ${state.tickets} tickets</p>
        <div class="row" style="margin-top:12px;">
          <button type="button" class="btn lg primary" data-goto="recruit">Recruit</button>
          <button type="button" class="btn lg" data-goto="heroes">Heroes</button>
        </div>
      </div>`;
  }

  function filteredHeroes() {
    let list = HEROES.slice();
    if (state.filters.role !== 'all') list = list.filter(h => h.role === state.filters.role);
    if (state.filters.rarity !== 'all') list = list.filter(h => h.rarity === state.filters.rarity);
    const rarityRank = { common:0, rare:1, epic:2, legendary:3 };
    const sort = state.filters.sort;
    list.sort((a,b) => {
      const oa = isOwned(a.id), ob = isOwned(b.id);
      if (oa !== ob) return oa ? -1 : 1;
      if (sort === 'name') return a.short.localeCompare(b.short);
      if (sort === 'level') return (state.owned[b.id]?.level||0) - (state.owned[a.id]?.level||0);
      if (sort === 'role') return a.role.localeCompare(b.role) || rarityRank[b.rarity]-rarityRank[a.rarity];
      return rarityRank[b.rarity]-rarityRank[a.rarity] || a.short.localeCompare(b.short);
    });
    return list;
  }

  function heroCard(h, opts = {}) {
    const o = state.owned[h.id];
    const locked = !o;
    const on = opts.selected === h.id || state.party && Object.values(state.party).includes(h.id) && opts.markParty;
    return `<button type="button" class="hero-card${locked?' is-locked':''}${on?' is-on':''}" data-rarity="${h.rarity}"
        data-open-hero="${locked?'':h.id}" data-locked-hero="${locked?h.id:''}" data-bench="${opts.bench?h.id:''}">
      <span class="art well">${sprite(h.id, SCALE.card, { locked })}${stars(o ? o.stars : 0)}</span>
      ${compactName(h)}
      <span class="row" style="gap:4px;flex-wrap:wrap;justify-content:center;">
        ${combatBadge(h)}
        ${o ? `<span class="muted">Lv ${o.level}</span>` : `<span class="muted">—</span>`}
      </span>
    </button>`;
  }

  function renderHeroes() {
    const list = filteredHeroes();
    $('#hero-grid').innerHTML = list.map(h => heroCard(h)).join('');
    $('#hero-count').textContent = `${Object.keys(state.owned).length} / ${HEROES.length} owned · ${list.length} shown`;
    $$('#filter-role .dd-list button').forEach(b => b.classList.toggle('is-on', b.dataset.val === state.filters.role));
    $$('#filter-rarity .dd-list button').forEach(b => b.classList.toggle('is-on', b.dataset.val === state.filters.rarity));
    $$('#filter-sort .dd-list button').forEach(b => b.classList.toggle('is-on', b.dataset.val === state.filters.sort));
    $('#filter-role .dd-btn span').textContent = state.filters.role === 'all' ? 'Role: All' : 'Role: ' + title(state.filters.role);
    $('#filter-rarity .dd-btn span').textContent = state.filters.rarity === 'all' ? 'Rarity: All' : 'Rarity: ' + title(state.filters.rarity);
    const sortLabel = { rarity:'Sort: Rarity', level:'Sort: Level', name:'Sort: Name', role:'Sort: Role' };
    $('#filter-sort .dd-btn span').textContent = sortLabel[state.filters.sort];
  }

  function statLine(label, value) {
    return `<div><span class="muted">${label}</span><strong>${value}</strong></div>`;
  }
  function itemStatParts(it) {
    if (!it) return [];
    const parts = [];
    if (it.stats.atk) parts.push(`ATK +${it.stats.atk}`);
    if (it.stats.hp) parts.push(`HP +${it.stats.hp}`);
    if (it.stats.def) parts.push(`DEF +${it.stats.def}`);
    if (it.stats.atkPct) parts.push(`ATK +${Math.round(it.stats.atkPct*100)}%`);
    if (it.stats.hpPct) parts.push(`HP +${Math.round(it.stats.hpPct*100)}%`);
    if (it.stats.speedPct) parts.push(`SPD +${Math.round(it.stats.speedPct*100)}%`);
    return parts;
  }
  function itemName(it) { return it ? `${title(it.rarity)} ${title(it.slot)}  Lv ${it.level}` : 'Empty'; }
  function itemLines(it) { return it ? `${itemName(it)}  ·  ${itemStatParts(it).join('  ')}` : 'Empty'; }
  function itemStatsHtml(it) {
    return itemStatParts(it).map(s => `<span class="stat-pair">${s}</span>`).join('');
  }

  function renderDetail() {
    const id = state.detailId;
    const h = hero(id), o = state.owned[id], st = statsOf(id);
    if (!h || !o || !st) return;
    const xp = xpNext(o.level);
    const tall = state.size === 1280;
    const manaNote = tall
      ? '<p class="muted">Basic actions grant 20 mana; tanks gain 5 on direct hostile HP damage.</p>'
      : '';
    $('#detail-root').innerHTML = `
      <div class="portrait-stage panel-inner" style="grid-area:portrait">
        <div class="art well" data-rarity="${h.rarity}">${sprite(id, tall ? SCALE.detail1280 : SCALE.detail960)}</div>
        <h2>${h.short}</h2>
        <p class="full-name">${h.name}</p>
        ${stars(o.stars)}
        <div class="row" style="gap:8px;flex-wrap:wrap;justify-content:center;">
          ${combatBadge(h)}
          ${rarityTag(h)}
        </div>
        ${catalogLine(h)}
        <p>Lv ${o.level} / 50${o.locked ? '  ·  Locked' : ''}</p>
        <div class="xp-bar"><i style="width:${Math.max(2, Math.round(o.xp/xp*100))}%;"></i></div>
        ${tall?`<p class="muted">${fmt(o.xp)} / ${fmt(xp)} XP</p>`:''}
      </div>
      <div class="col grow" style="grid-area:skills">
        <div class="panel-inner stats-panel">
          <h3>Stats</h3>
          <div class="stats-block" style="margin-top:8px;">
            ${statLine('HP', fmt(st.hp))}
            ${statLine('ATK', st.atk)}
            ${statLine('DEF', st.def)}
            ${statLine('Turn SPD', st.speedPct ? `${st.turn} +${Math.round(st.speedPct*100)}%` : String(st.turn))}
          </div>
          ${tall?`<p class="muted" style="margin-top:8px;">${h.strength}. ${h.weakness}.</p>`:''}
        </div>
        <div class="skill-card is-basic">
          <div class="ico">B</div>
          <div><h3>${h.basic.name}</h3><p class="muted">Basic</p><p>${h.basic.text}</p><p class="skill-meta">Scales with level and stars</p></div>
        </div>
        <div class="skill-card is-signature">
          <div class="ico">S</div>
          <div><h3>${h.signature.name}</h3><p class="gold">Signature  ·  Mana ${h.signature.mana}</p><p>${h.signature.text}</p><p class="skill-meta">Scales with level and stars</p>${manaNote}</div>
        </div>
        <div class="skill-card is-passive">
          <div class="ico">P</div>
          <div><h3>${h.passive.name}</h3><p class="muted">Passive</p><p>${h.passive.text}</p><p class="skill-meta">Scales with level and stars</p></div>
        </div>
      </div>
      <div class="equip-col" id="detail-equip" style="grid-area:equip"></div>`;
    $('#detail-equip').innerHTML = ['weapon','armor','charm'].map(slot => {
      const it = equipped(id, slot);
      const icon = slot === 'weapon' ? 'sword' : slot === 'armor' ? 'armor' : 'potion';
      return `<button type="button" class="equip-slot" data-rarity="${it?it.rarity:'common'}" data-open-equip="${id}" data-equip-slot="${slot}">
        <img class="icon" src="assets/ui/icon-${icon}.png" width="16" height="16" alt="" style="width:32px;height:32px;">
        <span class="equip-text">
          <strong class="equip-name">${it ? itemName(it) : title(slot) + '  ·  Empty'}</strong>
          <span class="equip-stats">${it ? itemStatsHtml(it) : ''}</span>
        </span>
      </button>`;
    }).join('') + `<button type="button" class="btn lg" data-open-equip="${id}" data-equip-slot="weapon">Equip</button>`;
  }

  function renderFormation() {
    $('#form-lane').innerHTML = SLOTS.map(slot => {
      const id = state.party[slot];
      const h = hero(id), o = state.owned[id], st = statsOf(id);
      const on = state.formPick === slot;
      return `<div class="form-slot panel-inner${on?' is-on':''}">
        <button type="button" class="form-slot-hit" data-slot="${slot}">
          <span class="gold">${slot}</span>
          <span class="art well">${sprite(id, SCALE.card)}</span>
          ${compactName(h, 'name-bust')}
          ${stars(o.stars)}
          ${combatBadge(h)}
        </button>
        <button type="button" class="btn form-equip-btn" data-open-equip="${id}" data-equip-slot="weapon">Equip</button>
      </div>`;
    }).join('');
    const bench = HEROES.filter(h => isOwned(h.id));
    $('#form-bench').innerHTML = bench.map(h => heroCard(h, { bench:true, selected: Object.values(state.party).includes(h.id) ? '' : null, markParty:true })).join('');
    const hint = state.formPick
      ? `FRONT / MIDDLE / REAR. Click a bench hero to place them in ${state.formPick}.`
      : 'FRONT / MIDDLE / REAR. Click a slot, then a bench hero to swap. Party size 3.';
    $('#form-hint').textContent = hint;
  }

  function renderGear() {
    const f = state.gearFilter;
    let list = state.items.slice();
    if (f.slot !== 'all') list = list.filter(i => i.slot === f.slot);
    if (f.rarity !== 'all') list = list.filter(i => i.rarity === f.rarity);
    const fortuneHost = $('#gear-fortune');
    if (fortuneHost) {
      fortuneHost.hidden = !RULES.gearFortune;
      if (RULES.gearFortune) fortuneHost.innerHTML = pityRow('Fortune', state.fortune, 100, '#e9bd68');
    }
    $('#gear-grid').innerHTML = list.map(it => {
      const icon = it.slot === 'weapon' ? 'sword' : it.slot === 'armor' ? 'armor' : 'potion';
      const on = state.selectedGear === it.id;
      return `<button type="button" class="gear-cell${on?' is-on':''}" data-rarity="${it.rarity}" data-gear="${it.id}" title="${itemLines(it)}">
        <img src="assets/ui/icon-${icon}.png" width="16" height="16" alt="">
        ${it.locked ? '<span style="position:absolute;font:10px Galmuri9,monospace;color:var(--gold);">L</span>' : ''}
      </button>`;
    }).join('');
    const it = itemById(state.selectedGear);
    const box = $('#gear-inspect');
    if (!it) { box.innerHTML = '<p class="muted">Select an item.</p>'; return; }
    const wearer = it.equipped ? hero(it.equipped) : null;
    const compare = wearer ? statsOf(wearer.id) : null;
    box.innerHTML = `
      <h3>${title(it.rarity)} ${title(it.slot)}</h3>
      <p class="rarity-tag ${it.rarity}">${it.rarity}</p>
      <p>Lv ${it.level} / 10 · dropped at stage ${it.dropStage}</p>
      <p style="margin:8px 0;">${itemLines(it)}</p>
      ${wearer ? `<p>Equipped by ${wearer.short}${compare ? ` · HP ${fmt(compare.hp)}  ATK ${compare.atk}  DEF ${compare.def}` : ''}</p>` : '<p class="muted">In stash</p>'}
      ${it.locked ? '<p class="gold">Locked</p>' : ''}
      <p class="muted" style="margin-top:8px;">Upgrade cost uses the current progression formula. Inventory ${state.items.length} / 50. Lock max 30.</p>
      <div class="col" style="margin-top:12px;gap:8px;">
        <button type="button" class="btn lg primary" data-act="equip">${it.equipped ? 'Unequip' : 'Equip to selected hero'}</button>
        <button type="button" class="btn lg" data-act="upgrade">Upgrade</button>
        <button type="button" class="btn" data-act="lock">${it.locked ? 'Unlock' : 'Lock'}</button>
      </div>`;
    $$('#gfilter-slot .dd-list button').forEach(b => b.classList.toggle('is-on', b.dataset.val === f.slot));
    $$('#gfilter-rarity .dd-list button').forEach(b => b.classList.toggle('is-on', b.dataset.val === f.rarity));
    $('#gfilter-slot .dd-btn span').textContent = f.slot === 'all' ? 'Slot: All' : 'Slot: ' + title(f.slot);
    $('#gfilter-rarity .dd-btn span').textContent = f.rarity === 'all' ? 'Rarity: All' : 'Rarity: ' + title(f.rarity);
  }

  function pityRow(label, used, limit, color, opts = {}) {
    const complete = !!opts.complete;
    const left = Math.max(0, limit - used);
    const pct = complete ? 100 : Math.min(100, Math.round(used / limit * 100));
    const status = complete ? 'Roster complete' : (left === 0 ? 'Ready' : `in ${left}`);
    const count = complete ? 'Roster complete' : `${used}/${limit}`;
    return `<div>
      <div class="pity-row"><strong>${label}</strong><span class="gold">${status}</span></div>
      <div class="bar"><i style="width:${pct}%;background:${color}"></i></div>
      <p class="muted">${count}</p>
    </div>`;
  }

  function renderRecruit() {
    $('#recruit-banners').innerHTML = `
      <div class="banner panel-inner ${state.banner==='standard'?'is-on':''}" data-banner="standard" style="${state.banner==='standard'?'box-shadow:inset 0 0 0 2px var(--gold)':''}">
        <h3>Standard banner</h3>
        <div class="art well" data-rarity="legendary">${sprite('mk2', state.size===1280 ? SCALE.banner1280 : SCALE.banner960)}</div>
        <p class="rarity-tag legendary">Legendary featured by rate</p>
        <p class="muted">Uniform pick within rarity. Cost 1 ticket.</p>
      </div>
      <div class="banner panel-inner">
        <h3>Odds</h3>
        <div class="odds" style="margin-top:12px;width:100%;">
          <span class="rarity-tag common">Common</span><span>50%</span>
          <span class="rarity-tag rare">Rare</span><span>33%</span>
          <span class="rarity-tag epic">Epic</span><span>13%</span>
          <span class="rarity-tag legendary">Legendary</span><span>4%</span>
        </div>
        <p class="muted" style="margin-top:12px;">Duplicates give +1 star (+12% stats) up to 6, then 100 × rarity gold.</p>
      </div>
      <div class="panel-inner pity-list">
        <h3>Pity</h3>
        ${pityRow('Epic+', state.pityEpic, 30, '#c19cd9', { complete: rosterComplete() })}
        ${RULES.recruitPity ? pityRow('Legend', state.pityLegend, 60, '#e9bd68', { complete: rosterComplete() }) : ''}
        ${RULES.recruitPity ? pityRow('New hero', state.pityNew, 20, '#90c99b', { complete: rosterComplete() }) : ''}
      </div>`;
    $('#recruit-actions').innerHTML = `
      <button type="button" class="btn lg primary" data-act="pull1">Recruit ×1  ·  1 ticket</button>
      <button type="button" class="btn lg" data-act="pull10">Recruit ×10  ·  10 tickets</button>
      <span class="gold" style="display:inline-flex;align-items:center;gap:8px;">
        <img src="assets/ui/icon-gold.png" width="16" height="16" alt="" style="width:16px;height:16px;">
        ${fmt(state.gold)}
        <img src="assets/ui/icon-potion.png" width="16" height="16" alt="" style="width:16px;height:16px;">
        ${state.tickets} tickets
      </span>`;
    $('#recruit-history').innerHTML = state.history.map(p =>
      `<span class="chip" title="${escapeAttr(hero(p.id).name)}"><span class="rarity-tag ${p.rarity}">${hero(p.id).short}</span>${p.dupe?' · dupe':''}</span>`
    ).join('') || '<span class="muted">No pulls yet.</span>';
  }

  function renderStages() {
    const chapters = [...new Set(STAGES.map(s => s.chapter))];
    $('#chapter-rail').innerHTML = chapters.map(c =>
      `<button type="button" class="chapter-tab${c===state.chapter?' is-on':''}" data-chapter="${c}" role="tab" aria-selected="${c===state.chapter}">Ch ${c}</button>`
    ).join('');
    const list = STAGES.filter(s => s.chapter === state.chapter);
    $('#stage-grid').innerHTML = list.map(s => {
      const cleared = state.cleared.has(s.id);
      const current = s.id === state.stageId;
      const locked = !cleared && !current && STAGES.findIndex(x => x.id === s.id) > STAGES.findIndex(x => x.id === state.stageId);
      const cls = [s.isBoss?'is-boss':'', cleared?'is-cleared':'', current?'is-current is-on':'', locked?'is-locked':''].filter(Boolean).join(' ');
      return `<button type="button" class="stage-node ${cls}" data-stage="${s.id}" ${locked?'disabled':''}>
        <strong>${s.id}</strong>
        <span class="muted">${s.isBoss ? 'BOSS' : s.waves + ' waves'}</span>
        ${cleared ? '<span class="green">Cleared</span>' : current ? '<span class="gold">Current</span>' : locked ? '<span>Locked</span>' : ''}
      </button>`;
    }).join('');
    const s = STAGES.find(x => x.id === state.stageId);
    const enemies = s.isBoss
      ? [['skeleton', 'Boss wave'], ['goblin','Adds'], ['fire-worm','Elite'], ['flying-eye','Air']]
      : [['goblin','Wave 1'], ['goblin','Wave 2'], ['skeleton','Wave 3']];
    $('#stage-detail').innerHTML = `
      <h3>Stage ${s.id}${s.isBoss?'  ·  Boss':''}</h3>
      <p>Chapter ${s.chapter} · ${s.waves} waves · ${s.timeoutSec}s timer</p>
      <p>First clear ${s.firstClearTickets} ticket${s.firstClearTickets>1?'s':''}. Full heal between stages. HP carries between waves.</p>
      <div class="row" style="margin:12px 0;flex-wrap:wrap;">
        ${enemies.map(([id,label]) => {
          const box = state.size === 960 ? 64 : 80;
          return `<div class="panel-inner" style="display:flex;flex-direction:column;align-items:center;min-width:${box+24}px;">
          <div class="art well" style="width:${box}px;height:${box}px;display:flex;align-items:flex-end;justify-content:center;">${enemySprite(id, box, box)}</div>
          <span class="muted">${label}</span>
        </div>`; }).join('')}
      </div>
      <div class="row">
        <button type="button" class="btn lg primary" data-act="push">Push ${s.id}</button>
        <button type="button" class="btn lg" data-act="farm"${s.isBoss?' disabled':''}>Farm ${s.isBoss ? '(boss uses Push)' : (state.cleared.has(s.id) ? s.id : '1-6')}</button>
      </div>
      <p class="muted" style="margin-top:8px;">${stageStatus(s)}. Non-boss farm is time-scaled. Boss is not auto-retried.</p>`;
  }

  function sliderEl(key, label, value) {
    return `<div class="setting-row">
      <span style="width:88px;">${label}</span>
      <div class="slider" data-slider="${key}">
        <div class="track"><i class="fill" style="width:${value}%;"></i><i class="thumb" style="left:calc(${value}% - 4px);"></i></div>
      </div>
      <span style="width:36px;text-align:right;">${value}</span>
    </div>`;
  }
  function toggleEl(key, label, on) {
    return `<div class="setting-row">
      <button type="button" class="toggle${on?' is-on':''}" data-toggle="${key}" aria-pressed="${on}"><i class="knob"></i></button>
      <span>${label}</span>
    </div>`;
  }

  function renderSettings() {
    const s = state.settings;
    $('#settings-body').innerHTML = `
      <div class="panel-inner col span-2">
        <h3>Offline progress</h3>
        <p>Farm 1-6 · ~1,240 gold/h · ~800 XP/h per hero</p>
        <p class="muted">Cap 8 hours · next chest after 1h 20m. Partial gold, XP, tickets, and chest progress carry across visits.</p>
      </div>
      <div class="panel-inner col">
        <h3>Simulation and audio</h3>
        ${toggleEl('paused', s.paused ? 'Simulation paused — click to resume' : 'Simulation running — click to pause', !s.paused)}
        ${toggleEl('muted', s.muted ? 'Audio muted' : 'Audio on', !s.muted)}
        ${sliderEl('volume','Volume', s.volume)}
        ${sliderEl('music','Music', s.music)}
        ${sliderEl('sfx','SFX', s.sfx)}
        ${sliderEl('ui','UI', s.ui)}
      </div>
      <div class="col" style="gap:12px;"><div class="panel-inner col">
        <h3>Window</h3>
        <div class="setting-row">
          <span style="width:88px;">Zoom</span>
          <button type="button" class="btn${s.zoom===1?' is-on':''}" data-zoom="1">1×</button>
          <button type="button" class="btn${s.zoom===2?' is-on':''}" data-zoom="2">2×</button>
        </div>
        <div class="setting-row">
          <span style="width:88px;">Placement</span>
          <button type="button" class="btn${s.placement==='free'?' is-on':''}" data-place="free">Free</button>
          <button type="button" class="btn${s.placement==='snapped'?' is-on':''}" data-place="snapped">Snap to bottom</button>
          <button type="button" class="btn" data-act="reset-size">Reset size</button>
        </div>
        <p class="muted">Integer zoom only. Letterbox rather than a fractional scale.</p>
      </div>
      <div class="panel-inner">
        <h3>Save recovery</h3>
        <p class="muted" style="margin:8px 0;">If a save cannot be loaded, use the game window recovery panel to export it or discard it. Autosaving pauses until you choose.</p>
        <button type="button" class="btn lg" data-act="recovery">Recovery help</button>
        <p id="recovery-note" class="muted" hidden style="margin-top:8px;">The original save is preserved when readable. Export it for recovery, or discard it to start fresh.</p>
      </div></div>`;
  }


  function deltaRow(label, curText, newText, curVal, newVal) {
    const diff = newVal - curVal;
    const cls = diff > 0 ? 'is-up' : diff < 0 ? 'is-down' : 'is-same';
    const sign = diff > 0 ? '+' + diff : (diff < 0 ? String(diff) : '');
    return `<div class="delta-row ${cls}"><span>${label}</span><span>${curText}  →  ${newText}</span><span class="delta-num">${sign}</span></div>`;
  }

  function renderEquip() {
    const id = state.equipHero;
    const h = hero(id), o = state.owned[id];
    if (!h || !o) return;
    const tall = state.size === 1280;
    const plate = tall ? 320 : 160;
    const [nw, nh] = SPRITE[id];
    const sc = scaleFit(nw, nh, tall ? 220 : 136, tall ? 268 : 156);
    const slot = state.equipSlot;
    const current = equipped(id, slot);
    const selected = state.equipItem ? itemById(state.equipItem) : null;
    const curStats = statsOf(id);
    const nextLoadout = selected ? loadoutWith(id, selected.slot, selected) : currentLoadout(id);
    const nextStats = statsOf(id, nextLoadout);

    const list = state.items
      .filter(it => it.slot === slot)
      .slice()
      .sort((a, b) => gearScore(b) - gearScore(a) || a.id.localeCompare(b.id));

    const wornBy = (it) => {
      if (!it || !it.equipped) return null;
      return hero(it.equipped);
    };

    const slotCard = (s) => {
      const it = equipped(id, s);
      const on = slot === s;
      if (!it) {
        return `<button type="button" class="equip-slot-card is-empty${on?' is-on':''}" data-slot="${s}" data-pick-slot="${s}">
          <span class="equip-slot-plus" aria-hidden="true">+</span>
          <span class="equip-slot-meta">
            <strong>${title(s)}</strong>
            <span class="muted">Empty</span>
          </span>
        </button>`;
      }
      return `<button type="button" class="equip-slot-card${on?' is-on':''}" data-rarity="${it.rarity}" data-slot="${s}" data-pick-slot="${s}">
        <span class="equip-slot-ico">
          <img src="assets/ui/icon-${slotIcon(s)}.png" width="16" height="16" alt="" style="width:32px;height:32px;">
          ${rarityShape(it.rarity)}
        </span>
        <span class="equip-slot-meta">
          <strong>${title(s)}</strong>
          <span class="equip-slot-lv">Lv ${it.level}</span>
          <span class="equip-stats">${itemStatsHtml(it)}</span>
        </span>
      </button>`;
    };

    const rows = list.map(it => {
      const wearer = wornBy(it);
      const on = state.equipItem === it.id;
      const mine = it.equipped === id;
      return `<button type="button" class="equip-row${on?' is-on':''}${mine?' is-mine':''}" data-rarity="${it.rarity}" data-pick-item="${it.id}">
        <span class="equip-row-ico">
          <img src="assets/ui/icon-${slotIcon(it.slot)}.png" width="16" height="16" alt="" style="width:24px;height:24px;">
          ${rarityShape(it.rarity)}
        </span>
        <span class="equip-row-body">
          <strong>${title(it.rarity)} ${title(it.slot)}  Lv ${it.level}</strong>
          <span class="equip-row-sub">
            <span class="equip-stats">${itemStatsHtml(it)}</span>
            ${wearer ? `<span class="worn-by">${mine ? 'Equipped' : 'Worn by ' + wearer.short}</span>` : ''}
          </span>
        </span>
        ${it.locked ? '<img class="lock-ico" src="assets/ui/icon-lock.png" width="16" height="16" alt="Locked">' : ''}
      </button>`;
    }).join('') || '<p class="muted">No items in this slot.</p>';

    let compare = '<p class="muted">Select an item to compare.</p>';
    let note = '';
    let actions = '';
    if (selected) {
      const wearer = wornBy(selected);
      const mine = selected.equipped === id;
      const other = wearer && !mine ? wearer : null;
      compare = `
        <h3>Compare</h3>
        ${deltaRow('HP', fmt(curStats.hp), fmt(nextStats.hp), curStats.hp, nextStats.hp)}
        ${deltaRow('ATK', String(curStats.atk), String(nextStats.atk), curStats.atk, nextStats.atk)}
        ${deltaRow('DEF', String(curStats.def), String(nextStats.def), curStats.def, nextStats.def)}
        ${deltaRow('Turn SPD', spdLabel(curStats), spdLabel(nextStats), spdValue(curStats), spdValue(nextStats))}`;
      if (other) note = `<p class="swap-note">${other.short} loses this item.</p>`;
      if (mine) note = `<p class="muted">Currently equipped.</p>`;
      const cost = upgradeCost(selected);
      const maxed = selected.level >= 10;
      const canAfford = state.gold >= cost;
      const primary = mine
        ? ''
        : `<button type="button" class="btn cta" data-act="equip-on">${other ? 'Swap' : 'Equip'}</button>`;
      actions = `
        ${primary}
        <button type="button" class="btn" data-act="unequip-slot"${current ? '' : ' disabled'}>Unequip</button>
        <button type="button" class="btn" data-act="upgrade-equip"${maxed || !canAfford ? ' disabled' : ''}>Upgrade  ·  ${maxed ? 'Max' : fmt(cost) + ' gold'}</button>
        <button type="button" class="btn" data-act="lock-equip">${selected.locked ? 'Unlock' : 'Lock'}</button>`;
    } else {
      actions = `<button type="button" class="btn" data-act="unequip-slot"${current ? '' : ' disabled'}>Unequip</button>`;
    }
    actions += `<button type="button" class="btn" data-act="auto-equip">Auto-equip best</button>`;
    // Keep the primary CTA as a direct child; wrap the 40 px secondaries for packing.
    actions = actions.replace(
      /(<button type="button" class="btn"(?! cta)[\s\S]*)/,
      '<div class="equip-actions-rest">$1</div>'
    );

    $('#equip-root').innerHTML = `
      <div class="equip-stage">
        <div class="equip-orbit" style="--plate:${plate}px">
          <button type="button" class="btn equip-arrow equip-arrow-prev" data-act="equip-prev" aria-label="Previous hero">‹</button>
          <button type="button" class="btn equip-arrow equip-arrow-next" data-act="equip-next" aria-label="Next hero">›</button>
          ${slotCard('weapon')}
          ${slotCard('armor')}
          ${slotCard('charm')}
          <span class="equip-arm arm-w" aria-hidden="true"></span>
          <span class="equip-arm arm-e" aria-hidden="true"></span>
          <span class="equip-arm arm-n" aria-hidden="true"></span>
          <div class="equip-core">
            <img class="equip-plate" src="assets/ui/equip-plate-${h.rarity}.png" width="160" height="160" alt="" draggable="false">
            <div class="equip-bust">${sprite(id, sc)}</div>
          </div>
        </div>
        <div class="equip-meta">
          <div class="equip-id">
            <h2>${h.short}</h2>
            <p class="full-name">${h.name}</p>
            <div class="row equip-tags">${combatBadge(h)} ${rarityTag(h)}</div>
          </div>
          <div class="equip-statsum">
            <span><span class="lab">HP</span> <span class="val">${fmt(curStats.hp)}</span></span>
            <span><span class="lab">ATK</span> <span class="val">${curStats.atk}</span></span>
            <span><span class="lab">DEF</span> <span class="val">${curStats.def}</span></span>
            <span><span class="lab">Turn SPD</span> <span class="val">${spdLabel(curStats)}</span></span>
          </div>
        </div>
      </div>
      <aside class="equip-drawer panel-inner">
        <div class="equip-list">
          <h3>${title(slot)}</h3>
          <div class="equip-rows">${rows}</div>
          <div class="equip-scroll-cue" aria-hidden="true">
            <img src="assets/ui/icon-scroll-more.png" width="11" height="7" alt="" style="width:22px;height:14px" draggable="false">
          </div>
        </div>
        <div class="equip-compare">
          ${compare}
          ${note}
          <div class="equip-actions">${actions}</div>
        </div>
      </aside>`;
    cueEquipList();
  }

  function cueEquipList() {
    const list = document.querySelector('#equip-root .equip-list');
    const rows = list && list.querySelector('.equip-rows');
    if (!list || !rows) return;
    // 1280: snap the scrollport to whole 48 px rows so Compare never mid-cuts a card.
    rows.style.maxHeight = '';
    if (state.size === 1280) {
      const row = rows.querySelector('.equip-row');
      if (row) {
        const gap = 6;
        const stride = row.offsetHeight + gap;
        if (rows.scrollHeight > rows.clientHeight + 1 && stride > 0) {
          const n = Math.max(1, Math.floor((rows.clientHeight + gap) / stride));
          rows.style.maxHeight = (n * row.offsetHeight + (n - 1) * gap) + 'px';
        }
      }
    }
    const update = () => {
      const more = rows.scrollHeight > rows.clientHeight + 1;
      const atEnd = rows.scrollTop + rows.clientHeight >= rows.scrollHeight - 2;
      const atStart = rows.scrollTop <= 1;
      list.classList.toggle('is-scrollable', more);
      list.classList.toggle('has-more', more && !atEnd);
      list.classList.toggle('has-prev', more && !atStart);
    };
    rows.addEventListener('scroll', update, { passive: true });
    requestAnimationFrame(update);
  }

  function doEquipOn() {
    const it = itemById(state.equipItem);
    const id = state.equipHero;
    if (!it || !isOwned(id)) return;
    const prev = equipped(id, it.slot);
    // Unequip from any current wearer (swap).
    if (it.equipped && it.equipped !== id) {
      // previous wearer simply loses it
    }
    if (prev && prev.id !== it.id) prev.equipped = null;
    it.equipped = id;
    toast(it.equipped === id ? (prev && prev.id !== it.id ? `Equipped  ·  swapped` : `Equipped  ·  ${hero(id).short}`) : '');
    render();
  }
  function doUnequipSlot() {
    const it = equipped(state.equipHero, state.equipSlot);
    if (it) it.equipped = null;
    render();
  }
  function doAutoEquip() {
    const id = state.equipHero;
    for (const slot of ['weapon','armor','charm']) {
      const options = state.items.filter(it => it.slot === slot);
      if (!options.length) continue;
      const best = options.slice().sort((a,b) => gearScore(b)-gearScore(a) || a.id.localeCompare(b.id))[0];
      const cur = equipped(id, slot);
      if (!best || (cur && gearScore(cur) >= gearScore(best) && cur.equipped === id)) continue;
      if (cur && cur.id !== best.id) cur.equipped = null;
      best.equipped = id;
    }
    toast(`Auto-equipped best  ·  ${hero(id).short}`);
    render();
  }

  function render() {
    wallet();
    const map = { home:renderHome, heroes:renderHeroes, detail:renderDetail, equip:renderEquip, formation:renderFormation, gear:renderGear, recruit:renderRecruit, stages:renderStages, settings:renderSettings };
    (map[state.screen] || renderHome)();
    requestAnimationFrame(fitNames);
  }

  /* ---------- events ---------- */
  function closeMenus(except) {
    $$('.dd').forEach(d => { if (d !== except) d.classList.remove('open'); });
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-size],[data-nav],[data-goto],[data-open-hero],[data-locked-hero],[data-open-equip],[data-pick-slot],[data-pick-item],[data-prog],[data-slot],[data-bench],[data-gear],[data-act],[data-stage],[data-chapter],[data-toggle],[data-zoom],[data-place],[data-dd],[data-val],.overlay');
    if (!e.target.closest('.dd')) closeMenus();

    const sizeBtn = e.target.closest('[data-size]');
    if (sizeBtn && sizeBtn.classList.contains('js-size')) { setSize(Number(sizeBtn.dataset.size)); return; }

    const progBtn = e.target.closest('[data-prog]');
    if (progBtn && progBtn.classList.contains('js-prog')) { setDemo(progBtn.dataset.prog); if (state.screen === 'home' || state.screen === 'stages') render(); return; }

    const nav = e.target.closest('[data-nav]');
    if (nav) { goto(nav.dataset.nav); return; }

    const go = e.target.closest('[data-goto]');
    if (go) {
      if (go.dataset.gear) state.selectedGear = go.dataset.gear;
      hideOverlay();
      goto(go.dataset.goto);
      return;
    }

    const locked = e.target.closest('[data-locked-hero]');
    if (locked && locked.dataset.lockedHero) { showHowto(locked.dataset.lockedHero); return; }

    const openEq = e.target.closest('[data-open-equip]');
    if (openEq && openEq.dataset.openEquip) {
      openEquip(openEq.dataset.openEquip, openEq.dataset.equipSlot || 'weapon', null, state.screen === 'formation' ? 'formation' : 'detail');
      return;
    }

    const open = e.target.closest('[data-open-hero]');
    if (open && open.dataset.openHero) { goto('detail', open.dataset.openHero); return; }

    const pickSlot = e.target.closest('[data-pick-slot]');
    if (pickSlot && pickSlot.dataset.pickSlot) {
      state.equipSlot = pickSlot.dataset.pickSlot;
      state.equipItem = null;
      renderEquip();
      return;
    }
    const pickItem = e.target.closest('[data-pick-item]');
    if (pickItem && pickItem.dataset.pickItem) {
      state.equipItem = pickItem.dataset.pickItem;
      renderEquip();
      return;
    }

    const slot = e.target.closest('[data-slot]');
    if (slot && state.screen === 'formation') {
      state.formPick = state.formPick === slot.dataset.slot ? null : slot.dataset.slot;
      renderFormation();
      return;
    }
    const bench = e.target.closest('[data-bench]');
    if (bench && bench.dataset.bench && state.screen === 'formation') {
      const id = bench.dataset.bench;
      if (state.formPick) {
        const other = Object.keys(state.party).find(s => state.party[s] === id);
        if (other) state.party[other] = state.party[state.formPick];
        state.party[state.formPick] = id;
        state.formPick = null;
        renderFormation();
      }
      return;
    }

    const g = e.target.closest('#gear-grid [data-gear]');
    if (g) { state.selectedGear = g.dataset.gear; renderGear(); return; }

    const stg = e.target.closest('[data-stage]');
    if (stg && !stg.disabled) { state.stageId = stg.dataset.stage; renderStages(); return; }
    const ch = e.target.closest('[data-chapter]');
    if (ch) { state.chapter = Number(ch.dataset.chapter); renderStages(); return; }

    const tog = e.target.closest('[data-toggle]');
    if (tog) {
      const key = tog.dataset.toggle;
      if (key === 'paused') state.settings.paused = !state.settings.paused;
      if (key === 'muted') state.settings.muted = !state.settings.muted;
      renderSettings();
      return;
    }
    const z = e.target.closest('[data-zoom]');
    if (z && z.dataset.zoom) { state.settings.zoom = Number(z.dataset.zoom); renderSettings(); return; }
    const pl = e.target.closest('[data-place]');
    if (pl) { state.settings.placement = pl.dataset.place; renderSettings(); return; }

    const dd = e.target.closest('[data-dd]');
    if (dd) { closeMenus(dd.closest('.dd')); dd.closest('.dd').classList.toggle('open'); return; }
    const val = e.target.closest('[data-val]');
    if (val) {
      const box = val.closest('.dd');
      const key = box.dataset.filter;
      const group = box.dataset.group;
      if (group === 'heroes') state.filters[key] = val.dataset.val;
      if (group === 'gear') state.gearFilter[key] = val.dataset.val;
      closeMenus();
      render();
      return;
    }

    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'pull1' || a === 'pull10') {
        const n = a === 'pull10' ? 10 : 1;
        if (state.tickets < n) return;
        state.tickets -= n;
        // Prototype reveal: cycle a locked or owned hero for feedback, do not invent new rates in the UI copy.
        const pool = HEROES.filter(h => h.rarity === 'rare' || h.rarity === 'common');
        const pick = pool[Math.floor(Math.random() * pool.length)];
        showReveal(pick);
        state.pityEpic = Math.min(29, state.pityEpic + n);
        state.history.unshift({ id:pick.id, rarity:pick.rarity, dupe:isOwned(pick.id) });
        wallet();
        if (state.screen === 'recruit') renderRecruit();
        return;
      }
      if (a === 'equip') {
        const it = itemById(state.selectedGear);
        if (it) it.equipped = it.equipped ? null : (state.detailId && isOwned(state.detailId) ? state.detailId : state.party.FRONT);
        renderGear();
        return;
      }
      if (a === 'equip-on') { doEquipOn(); return; }
      if (a === 'unequip-slot') { doUnequipSlot(); return; }
      if (a === 'auto-equip') { doAutoEquip(); return; }
      if (a === 'equip-prev') { cycleEquip(-1); return; }
      if (a === 'equip-next') { cycleEquip(1); return; }
      if (a === 'equip-back') {
        const from = state.equipFrom === 'formation' ? 'formation' : 'detail';
        goto(from, state.equipHero);
        return;
      }
      if (a === 'upgrade-equip') {
        const it = itemById(state.equipItem);
        if (it && it.level < 10) {
          const cost = upgradeCost(it);
          if (state.gold >= cost) { state.gold -= cost; it.level += 1; wallet(); renderEquip(); }
        }
        return;
      }
      if (a === 'lock-equip') {
        const it = itemById(state.equipItem);
        if (it) it.locked = !it.locked;
        renderEquip();
        return;
      }
      if (a === 'upgrade') {
        const it = itemById(state.selectedGear);
        if (it && it.level < 10) {
          const cost = upgradeCost(it);
          if (state.gold >= cost) { state.gold -= cost; it.level += 1; wallet(); renderGear(); }
        }
        return;
      }
      if (a === 'lock') {
        const it = itemById(state.selectedGear);
        if (it) it.locked = !it.locked;
        renderGear();
        return;
      }
      if (a === 'fight-boss') {
        state.progression = 'BOSS_FIGHT';
        state.stageId = state.stageId;
        const stage = STAGES.find(s => s.id === state.stageId);
        if (stage) state.chapter = stage.chapter;
        goto('stages');
        return;
      }
      if (a === 'push' || a === 'farm') {
        if (a === 'push') state.progression = STAGES.find(s => s.id === state.stageId).isBoss ? 'BOSS_FIGHT' : 'PUSHING';
        else state.progression = 'FARMING';
        renderStages();
        return;
      }
      if (a === 'recovery') {
        const note = $('#recovery-note');
        if (note) note.hidden = !note.hidden;
        return;
      }
      if (a === 'reset-size') { state.settings.zoom = 1; renderSettings(); return; }
      if (a === 'back') { goto('heroes'); return; }
    }

    if (e.target.closest('.overlay') && !e.target.closest('.howto-card, .reveal-card')) hideOverlay();
  });

  document.addEventListener('pointerdown', (e) => {
    const sl = e.target.closest('[data-slider]');
    if (!sl) return;
    const key = sl.dataset.slider;
    const track = sl.querySelector('.track');
    const move = (ev) => {
      const r = track.getBoundingClientRect();
      const v = Math.max(0, Math.min(100, Math.round((ev.clientX - r.left) / r.width * 100)));
      state.settings[key] = v;
      renderSettings();
    };
    move(e);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  function showReveal(h) {
    const ov = $('#overlay');
    const wasOwned = isOwned(h.id);
    ov.innerHTML = `<div class="reveal-card panel-inner" data-rarity="${h.rarity}" style="border:2px solid var(--${h.rarity === 'legendary' ? 'gold' : h.rarity === 'epic' ? 'purple' : h.rarity === 'rare' ? 'blue' : 'common'});">
      ${rarityTag(h)}
      <div class="art well" data-rarity="${h.rarity}">${sprite(h.id, SCALE.reveal)}</div>
      ${compactName(h, 'name-title')}
      ${combatBadge(h)}
      <p class="muted">${wasOwned ? 'Duplicate  ·  +1 star (+12% stats)' : 'New hero'}</p>
      <button type="button" class="btn lg primary" id="reveal-ok">OK</button>
    </div>`;
    ov.classList.add('is-on');
    requestAnimationFrame(fitNames);
    $('#reveal-ok').addEventListener('click', hideOverlay);
    toast(wasOwned ? `${h.short}  ·  Duplicate  ·  +1 star` : `${h.short}  ·  New hero`);
  }
  function showHowto(id) {
    const h = hero(id);
    if (!h) return;
    const ov = $('#overlay');
    ov.innerHTML = `<div class="howto-card panel-inner" data-rarity="${h.rarity}">
      <div class="art well" data-rarity="${h.rarity}">${sprite(h.id, SCALE.card, { locked:true })}</div>
      ${compactName(h, 'name-title')}
      <div class="row" style="gap:8px;flex-wrap:wrap;justify-content:center;">
        ${rarityTag(h)}
        <span class="badge">${title(h.catalog)}</span>
      </div>
      <p>Signature  ·  ${h.signature.name}</p>
      <p>Base odds per pull  ·  ${pullOdds(h.rarity)}</p>
      <p class="howto-pity muted">Pity raises this</p>
      <button type="button" class="btn lg primary" data-goto="recruit" id="howto-recruit">Go to Recruit</button>
    </div>`;
    ov.classList.add('is-on');
    requestAnimationFrame(fitNames);
  }
  function hideOverlay() { $('#overlay').classList.remove('is-on'); $('#overlay').innerHTML = ''; }
  function hideReveal() { hideOverlay(); }

  // expose for the capture script
  document.addEventListener('keydown', (e) => {
    if (state.screen !== 'equip') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); cycleEquip(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); cycleEquip(1); }
  });

  window.Proto = { goto, setSize, setDemo, showHowto, hideOverlay, openEquip, cycleEquip, state, render, show: (screen, id) => goto(screen, id) };

  setSize(1280);
  goto('home');
})();
