// Offline regression tests for the actual inline app script (no browser dependency).
// Run: node --test --test-isolation=none tests/shiren6.test.cjs (Node 22+)
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

function app(storage = new Map(), unavailable = false) {
  const nodes = new Map();
  function attributes(tag) {
    const attrs = {};
    for (const match of tag.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[match[1]] = match[2];
    return attrs;
  }
  function parse(fragment) {
    for (const match of fragment.matchAll(/<([a-z][a-z0-9]*)[^>]*\bid="[^"]+"[^>]*>/g)) {
      const attrs = attributes(match[0]);
      if (!nodes.has(attrs.id)) nodes.set(attrs.id, node(attrs.id, match[1], attrs));
    }
  }
  function node(id, tag, attrs = {}) {
    let content = '';
    return {
      id, tagName: tag.toUpperCase(), type: attrs.type || '',
      value: attrs.value || '', min: attrs.min || '', max: attrs.max || '', step: attrs.step || '',
      checked: false, disabled: false, textContent: '', style: {}, options: [],
      classList: {add(){},remove(){},toggle(){}},
      get innerHTML() {return content;},
      set innerHTML(value) {
        content = value;
        parse(value);
        if (tag === 'select') {
          this.options = [...value.matchAll(/<option value="([^"]*)"/g)].map(m => ({value:m[1]}));
          this.value = this.options[0]?.value || '';
        }
      },
    };
  }
  parse(html);
  for (const match of html.matchAll(/<select[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) nodes.get(match[1]).innerHTML = match[2];
  const ctx = vm.createContext({
    console, confirm: () => true,
    localStorage: {
      getItem(key) {if (unavailable) throw Error('storage disabled'); return storage.get(key) || null;},
      setItem(key,value) {if (unavailable) throw Error('storage disabled'); storage.set(key,value);},
    },
    document: {
      getElementById(id) {if (!nodes.has(id)) throw Error('Missing element: ' + id); return nodes.get(id);},
      querySelector: () => ({style:{}}),
      querySelectorAll(selector) {
        if (selector === '#damagePanel input, #damagePanel select') return [...nodes.values()].filter(n => n.id.startsWith('damage') && ['INPUT','SELECT'].includes(n.tagName));
        if (selector === '.tab') return [];
        throw Error('Unimplemented selector: ' + selector);
      },
    },
  });
  const run = expression => vm.runInContext(expression, ctx, {timeout:5000});
  run(source);
  return {run, nodes, storage, set:(id,value) => {nodes.get(id).value = String(value);}, check:(id,value=true) => {nodes.get(id).checked = value;}, text:id => nodes.get(id).textContent};
}

test('app initializes and all inline handler functions are defined', () => {
  const a = app();
  const markup = html.slice(0, html.lastIndexOf('<script>'));
  const handlers = new Set([...markup.matchAll(/(?:onclick|onchange|oninput)="([^"\n]+)"/g)].flatMap(m => [...m[1].matchAll(/(?<![.\w])([A-Za-z_]\w*)\(/g)].map(x => x[1])).filter(x => x !== 'if'));
  for (const name of handlers) assert.equal(a.run(`typeof ${name}`), 'function', name);
  assert.ok(a.nodes.get('itemList').innerHTML.includes('胃縮小の種'));
  assert.equal(a.run("ITEMS.herb.find(x => x.name === '胃縮小の種').effect"), '最大満腹度-5');
});

test('attack seals add, direct weapon strength works, condition reload preserves values', () => {
  const a = app();
  a.check('damageWeaponDirect'); a.set('damageWeaponTotal', 20);
  a.check('damageAttackSeal0'); a.check('damageAttackSeal1');
  a.run('damageRender()');
  assert.equal(a.text('damageMin'), '52'); // (8 + 20 + 1 + 1) * .875 * 2
  assert.equal(a.text('damageMax'), '67');
  assert.ok(a.nodes.get('damageBreakdown').innerHTML.includes('特攻倍率 1 ＋ 1 = 2倍'));
  assert.equal(a.nodes.get('damageWeapon').disabled, true);
  const reloaded = app(a.storage);
  assert.equal(reloaded.nodes.get('damageWeaponDirect').checked, true);
  assert.equal(reloaded.nodes.get('damageWeaponTotal').value, '20');
  assert.equal(reloaded.nodes.get('damageAttackSeal0').checked, true);
  assert.equal(reloaded.text('damageMin'), '52');
});

test('reduction seals multiply and defense correction never divides by zero', () => {
  const a = app();
  a.check('damageShieldDirect'); a.set('damageShieldTotal',20);
  a.check('damageDefenseSeal0'); a.check('damageDefenseSeal1');
  a.run("damageSetMode('receive')");
  assert.equal(a.text('damageMin'), '34'); // (100-20+1) * .875 * .7 * .7
  assert.equal(a.text('damageMax'), '44');
  a.set('damageDefenseBuff',0); a.run('damageRender()');
  assert.ok(!/Infinity|NaN/.test(a.text('damageMin') + a.text('damageMax')));
  assert.equal(app(a.storage).run('damageMode'), 'receive');
});

test('numeric inputs clamp to minimum and bare hands ignore retained enhancement', () => {
  const a = app();
  a.set('damageStrength',-100); a.set('damageLevel',-10); a.set('damageWeaponEnhance',99);
  a.run('damageRender()');
  assert.equal(a.text('damageMin'),'1'); assert.equal(a.text('damageMax'),'2');
  a.set('damageStrength',''); a.run('damageRender()');
  assert.equal(a.text('damageMin'),'8');
  a.set('damageStrength','1e999'); a.run('damageRender()');
  assert.ok(!/NaN|Infinity/.test(a.text('damageMin')));
  a.set('damageStrength','1e308'); a.check('damageWeaponDirect'); a.set('damageWeaponTotal','1e308'); a.run('damageRender()');
  assert.equal(a.text('damageMin'),'—');
  assert.ok(a.text('damageResultSub').includes('大きすぎる'));
});

test('price status and buy/sell filters including count-dependent prices', () => {
  const a = app();
  a.set('priceSide','buy'); a.set('priceCondition','cursed');
  a.set('priceFilter',174); a.run('applyFilterInput()');
  assert.ok(a.nodes.get('itemList').innerHTML.includes('胃縮小の種'));
  assert.ok(!a.nodes.get('itemList').innerHTML.includes('薬草のメモ'));
  a.set('priceSide','sell'); a.set('priceFilter',174); a.run('applyFilterInput()');
  assert.ok(!a.nodes.get('itemList').innerHTML.includes('胃縮小の種'));
  a.run('clearFilter()'); a.set('priceCondition','blessed'); a.set('priceSide','buy'); a.set('priceFilter',400); a.run('applyFilterInput()');
  assert.ok(a.nodes.get('itemList').innerHTML.includes('胃縮小の種'));
  a.run("switchTab('staff'); clearFilter()");
  a.set('priceCondition','cursed'); a.run('toggleCount(4)');
  assert.equal(a.run("priceVariants(ITEMS.staff.find(x => x.counts.includes(4)),'buy',4)[0]"), a.run("Math.floor(getBuy(ITEMS.staff.find(x => x.counts.includes(4)),4)*87/100)"));
  a.set('priceCondition','blessed'); a.run('render()');
  assert.equal(a.nodes.get('noResults').style.display,'block');
});

test('removed identification helpers stay absent; name search and status cycling still work', () => {
  const oldNotes = JSON.stringify({'herb:雑草': {alias:'あおい草',memo:'古いメモ'}});
  const a = app(new Map([['shiren6-item-notes',oldNotes]]));
  const herbName = a.run('ITEMS.herb[0].name');
  assert.equal(a.nodes.has('unknownOnly'),false);
  assert.equal(a.nodes.has('noteSaveStatus'),false);
  assert.ok(!a.nodes.get('itemList').innerHTML.includes('item-notes'));
  assert.ok(!a.nodes.get('itemList').innerHTML.includes('<input'));
  a.set('nameFilter','あおい草'); a.run('render()');
  assert.equal(a.nodes.get('noResults').style.display,'block');
  a.set('nameFilter',herbName); a.run('render()');
  assert.ok(a.nodes.get('itemList').innerHTML.includes(herbName));
  a.run("cycleStatus('herb',ITEMS.herb[0].name)");
  assert.ok(a.nodes.get('itemList').innerHTML.includes('s-identified'));
  a.run("cycleStatus('herb',ITEMS.herb[0].name)");
  assert.ok(a.nodes.get('itemList').innerHTML.includes('s-absent'));
  a.run('clearFilter()');
  const reloaded = app(a.storage);
  assert.equal(reloaded.run("getStatus('herb',ITEMS.herb[0].name)"),'absent');
  assert.equal(reloaded.storage.get('shiren6-item-notes'),oldNotes);
});

test('boyoyon recommendation prioritizes feet, grid headings and native direction buttons', () => {
  const a = app();
  a.run("boyoSetMode('play'); boyoRecommend()");
  assert.equal(a.run('boyoViable(boyoSel.r,boyoSel.c)[boyoDir].caught'),true);
  assert.ok(a.nodes.get('boyoMsg').innerHTML.includes('から'));
  assert.ok(a.nodes.get('boyoMsg').innerHTML.includes('に投げる'));
  assert.ok(a.nodes.get('boyoMsg').innerHTML.includes('<button class="boyo-dir-btn'));
  assert.ok(a.nodes.get('boyoGrid').innerHTML.includes('scope="col"'));
  assert.ok(a.nodes.get('boyoGrid').innerHTML.includes('scope="row"'));
  a.check('boyoFeetOnly'); a.run('boyoFilterChanged()');
  assert.equal(a.run('boyoCandidates().every(x => x.caught && x.success)'),true);
});

test('room edits undo, dimensions preserve inner walls, reload restores room and selection', () => {
  const a = app();
  a.run("boyoToggleWall(2,2); boyoResize('w',1)");
  assert.equal(a.run("boyoWalls.has('2,2')"),true);
  assert.equal(a.run('boyoW'),6);
  a.run('boyoUndo()'); assert.equal(a.run('boyoW'),5);
  a.run('boyoUndo()'); assert.equal(a.run("boyoWalls.has('2,2')"),false);
  a.run("boyoToggleWall(-1,1); boyoSetMode('play'); boyoRecommend()");
  const reloaded = app(a.storage);
  assert.equal(reloaded.run("boyoWalls.has('-1,1')"),false);
  assert.equal(reloaded.run('boyoMode'),'play');
  assert.equal(reloaded.run('JSON.stringify(boyoSel)'),a.run('JSON.stringify(boyoSel)'));
  assert.equal(reloaded.run('boyoDir'),a.run('boyoDir'));
  reloaded.run('boyoRender()'); assert.equal(reloaded.nodes.get('boyoUndo').disabled,true);
});

test('all 1–12 rectangular room sizes produce bounded, valid recommendations', () => {
  const a = app();
  for (let h=1; h<=12; h++) for (let w=1; w<=12; w++) {
    a.run(`boyoW=${w}; boyoH=${h}; boyoInitWalls(); boyoSel=null; boyoDir=null`);
    assert.equal(a.run('boyoCandidates().every(x => x.success && x.path.length <= 241 && x.bounces <= 24)'),true, `${w}x${h}`);
  }
  a.run('boyoW=1;boyoH=1;boyoInitWalls();boyoRecommend();boyoRender()');
  assert.equal(a.run('boyoCandidates().length'),0);
  assert.ok(a.nodes.get('boyoSolutionList').innerHTML.includes('ありません'));
});

test('invalid saved room and unavailable storage fail safely', () => {
  const data = new Map([['shiren6-boyoyon-room','{"w":999,"h":-1,"walls":[]}'], ['shiren6-damage-conditions','{broken']]);
  const a = app(data);
  assert.equal(a.run('boyoW'),5);
  assert.equal(a.run("boyoRestore({w:5,h:5,walls:['NaN,0']})"),false);
  const blocked = app(new Map(),true);
  blocked.run("boyoRender(); cycleStatus('herb','薬草')");
  assert.ok(blocked.text('damageSaveStatus').includes('保存できません'));
  assert.ok(blocked.text('boyoSaveStatus').includes('保存できません'));
  const corrupted = app(new Map([['shiren6-id-state','{"herb":null,"staff":[],"pot":"bad"}']]));
  assert.equal(corrupted.run("getStatus('herb','薬草')"), 'unknown');
});

test('cursed and blessed chips use transformed prices and switching conditions clears stale chips', () => {
  const a = app();
  a.set('priceCondition','cursed'); a.run('priceOptionsChanged()');
  assert.ok(a.nodes.get('chipRowBuy').innerHTML.includes("toggleChip(174,'buy')"));
  a.run("toggleChip(174,'buy')");
  assert.ok(a.nodes.get('itemList').innerHTML.includes('胃縮小の種'));
  assert.ok(a.nodes.get('itemList').innerHTML.includes('highlighted'));
  a.set('priceCondition','blessed'); a.run('priceOptionsChanged()');
  assert.equal(a.run('selectedPrices.size'),0);
  assert.ok(a.nodes.get('chipRowBuy').innerHTML.includes("toggleChip(400,'buy')"));
  a.set('priceCondition','normal-blessed'); a.set('priceSide','buy'); a.set('priceFilter',174); a.run('applyFilterInput()');
  assert.ok(!a.nodes.get('itemList').innerHTML.includes('胃縮小の種'));
});

test('normal plus blessed includes both prices but never cursed prices, including chips and counts', () => {
  const a = app();
  const conditionMarkup = html.match(/<select[^>]*id="priceCondition"[^>]*>([\s\S]*?)<\/select>/)[1];
  assert.deepEqual([...conditionMarkup.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map(m => [m[1],m[2]]), [
    ['normal','通常'],['cursed','呪い'],['blessed','祝福'],['normal-blessed','通常＋祝福'],
  ]);
  a.set('priceCondition','normal-blessed'); a.set('priceSide','buy'); a.run('priceOptionsChanged()');
  const values = side => JSON.parse(a.run(`JSON.stringify(priceVariants(ITEMS.herb.find(x => x.name === '胃縮小の種'),'${side}',null))`));
  assert.deepEqual(values('buy'),[200,400]);
  assert.deepEqual(values('sell'),[80,160]);
  assert.ok(!a.nodes.get('chipRowBuy').innerHTML.includes("toggleChip(174,'buy')"));
  assert.ok(a.nodes.get('itemList').innerHTML.includes('200 / 400G'));
  assert.ok(a.nodes.get('itemList').innerHTML.includes('通常＋祝福'));
  for (const side of ['buy','sell']) {
    a.set('priceSide',side);
    for (const price of values(side)) {
      a.set('priceFilter',price); a.run('applyFilterInput()');
      assert.ok(a.nodes.get('itemList').innerHTML.includes('胃縮小の種'));
    }
    a.set('priceFilter',side === 'buy' ? 174 : 69); a.run('applyFilterInput()');
    assert.ok(!a.nodes.get('itemList').innerHTML.includes('胃縮小の種'));
  }
  a.set('priceSide','buy'); a.set('priceFilter',200); a.run('applyFilterInput()');
  assert.ok(a.nodes.get('itemList').innerHTML.includes('くねくね草')); // 100Gの祝福
  assert.ok(a.nodes.get('itemList').innerHTML.includes('胃縮小の種')); // 200Gの通常
  a.run("switchTab('staff'); clearFilter(); toggleCount(4)");
  a.set('priceCondition','normal-blessed'); a.run('priceOptionsChanged()');
  assert.equal(a.run("JSON.stringify(priceVariants(ITEMS.staff.find(x => x.counts.includes(4)),'buy',4))"),a.run("JSON.stringify([getBuy(ITEMS.staff.find(x => x.counts.includes(4)),4)])"));
  assert.equal(a.nodes.get('noResults').style.display,'none');
});

test('100G buy-chip matches example herbs with the correct normal or blessed border', () => {
  const a = app();
  a.set('priceCondition','normal-blessed'); a.run("priceOptionsChanged(); toggleChip(100,'buy')");
  const expected = [['暴走の種','blessed'],['毒草','blessed'],['くねくね草','normal'],['高飛び草','normal']];
  for (const [name,state] of expected) {
    const states = JSON.parse(a.run(`JSON.stringify(matchingPriceStates(ITEMS.herb.find(x => x.name === '${name}')))`));
    assert.deepEqual(states,[state]);
    // Scope by splitting cards rather than accepting an earlier card's class.
    const fragment = a.nodes.get('itemList').innerHTML.split('<div class="item-card ').find(s => s.includes(`<div class="item-name">${name}`));
    assert.ok(fragment);
    assert.ok(fragment.slice(0,fragment.indexOf('">')).includes('price-match-' + state));
    assert.ok(fragment.includes(state === 'blessed' ? '祝福価格で一致' : '通常価格で一致'));
  }
  assert.equal(a.text('filterCount'),'4件該当');
});

test('numeric buy and sell filters choose only the matching price state', () => {
  const a = app();
  a.set('priceCondition','normal-blessed');
  const states = name => JSON.parse(a.run(`JSON.stringify(matchingPriceStates(ITEMS.herb.find(x => x.name === '${name}')))`));
  for (const [side,price,name,expected] of [
    ['buy',100,'毒草','blessed'],['buy',100,'高飛び草','normal'],
    ['sell',40,'毒草','blessed'],['sell',40,'高飛び草','normal'],
    ['either',100,'毒草','blessed'],
  ]) {
    a.set('priceSide',side); a.set('priceFilter',price); a.run('applyFilterInput()');
    assert.deepEqual(states(name),[expected]);
  }
  a.set('priceSide','sell'); a.set('priceFilter',100); a.run('applyFilterInput()');
  assert.deepEqual(states('毒草'),[]);
});

test('normal-price matches appear before blessed-price matches for buy/sell chips and numeric input', () => {
  const a = app();
  const names = () => [...a.nodes.get('itemList').innerHTML.matchAll(/<div class="item-name">([^<]+)/g)].map(m => m[1]);
  const expected = ['くねくね草','高飛び草','暴走の種','毒草'];
  a.set('priceCondition','normal-blessed'); a.run("priceOptionsChanged(); toggleChip(100,'buy')");
  assert.deepEqual(names(),expected);
  a.set('priceSide','buy');
  a.set('priceFilter',100); a.run('applyFilterInput()');
  assert.deepEqual(names(),expected);
  a.run('clearFilter()'); a.set('priceCondition','normal-blessed');
  a.run("priceOptionsChanged(); toggleChip(40,'sell')");
  assert.deepEqual(names(),expected);
  a.set('priceSide','sell'); a.set('priceFilter',40); a.run('applyFilterInput()');
  assert.deepEqual(names(),expected);
});

test('price groups take precedence over status while status ordering remains within each group', () => {
  const a = app();
  a.run("cycleStatus('herb','くねくね草'); cycleStatus('herb','暴走の種')");
  a.set('priceCondition','normal-blessed'); a.run("priceOptionsChanged(); toggleChip(100,'buy')");
  const names = () => [...a.nodes.get('itemList').innerHTML.matchAll(/<div class="item-name">([^<]+)/g)].map(m => m[1]);
  assert.deepEqual(names(),['高飛び草','くねくね草','毒草','暴走の種']);
  a.run('clearFilter()');
  assert.equal(names()[0],a.run('ITEMS.herb[0].name'));
  assert.equal(names().at(-2),'暴走の種');
  assert.equal(names().at(-1),'くねくね草');
});

test('items matching both states stay in the normal group when multiple prices are selected', () => {
  const a = app();
  a.set('priceCondition','normal-blessed'); a.run("priceOptionsChanged(); toggleChip(100,'buy'); toggleChip(200,'buy')");
  const names = [...a.nodes.get('itemList').innerHTML.matchAll(/<div class="item-name">([^<]+)/g)].map(m => m[1]);
  let reachedBlessedOnly = false;
  for (const name of names) {
    const states = JSON.parse(a.run(`JSON.stringify(matchingPriceStates(ITEMS.herb.find(x => x.name === '${name}')))`));
    if (states.includes('normal')) assert.equal(reachedBlessedOnly,false);
    else reachedBlessedOnly = true;
  }
  assert.ok(reachedBlessedOnly);
  assert.ok(names.indexOf('くねくね草') < names.indexOf('毒草'));
});

test('multiple price chips and buy/sell combinations show both states without duplicate matches', () => {
  const a = app();
  a.set('priceCondition','normal-blessed'); a.run("priceOptionsChanged(); toggleChip(100,'buy'); toggleChip(200,'buy')");
  const result = () => JSON.parse(a.run("JSON.stringify(priceMatchDisplay(matchingPriceStates(ITEMS.herb.find(x => x.name === 'くねくね草'))))"));
  assert.deepEqual(result(),{className:'price-match-both',label:'通常・祝福価格で一致'});
  assert.ok(a.nodes.get('itemList').innerHTML.includes('price-match-both'));
  a.run("toggleChip(200,'buy'); toggleChip(80,'sell')");
  assert.equal(result().className,'price-match-both');
  a.set('priceSide','buy'); a.run('render()');
  assert.equal(result().className,'price-match-normal');
  a.set('priceSide','sell'); a.run('render()');
  assert.equal(result().className,'price-match-blessed');
});

test('single-state modes, count-only filters, status changes, and clearing keep highlights accurate', () => {
  const a = app();
  a.set('priceCondition','cursed'); a.set('priceFilter',174); a.run('applyFilterInput()');
  assert.ok(a.nodes.get('itemList').innerHTML.includes('price-match-cursed'));
  assert.ok(a.nodes.get('itemList').innerHTML.includes('呪い価格で一致'));
  a.set('priceCondition','blessed'); a.set('priceFilter',100); a.run('applyFilterInput()');
  assert.ok(a.nodes.get('itemList').innerHTML.includes('price-match-blessed'));
  a.run("cycleStatus('herb','毒草')");
  assert.ok(a.nodes.get('itemList').innerHTML.includes('identified highlighted price-match price-match-blessed'));
  a.run('clearFilter()');
  assert.ok(!a.nodes.get('itemList').innerHTML.includes('price-match-label'));
  assert.ok(!a.nodes.get('itemList').innerHTML.includes('price-match-blessed'));
  a.set('nameFilter','毒草'); a.run('render()');
  assert.ok(!a.nodes.get('itemList').innerHTML.includes('price-match-label'));
  a.run("switchTab('staff'); clearFilter(); toggleCount(4)");
  assert.ok(a.nodes.get('itemList').innerHTML.includes('highlighted'));
  assert.ok(!a.nodes.get('itemList').innerHTML.includes('price-match-label'));
});

test('price-match colors contrast with the dark card and label backgrounds', () => {
  function luminance(hex) {
    const channels = hex.match(/[0-9a-f]{2}/gi).map(n => parseInt(n,16)/255).map(n => n <= 0.04045 ? n/12.92 : ((n+0.055)/1.055)**2.4);
    return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
  }
  function ratio(a,b) {return (Math.max(luminance(a),luminance(b))+0.05)/(Math.min(luminance(a),luminance(b))+0.05);}
  for (const foreground of ['#ffd54f','#67e8f9']) {
    assert.ok(html.includes(foreground));
    assert.ok(ratio(foreground,'#1a1a2e')>7);
    assert.ok(ratio(foreground,'#1e2a45')>7);
  }
  assert.ok(/\.item-card\.price-match\s*\{[^}]*border-width:\s*2px;[^}]*opacity:\s*1;/s.test(html));
});

test('irregular rooms, exits, feet-only filter, undo limit, and size limits remain safe', () => {
  const a = app();
  for (let shape=0; shape<40; shape++) {
    a.run(`boyoW=6;boyoH=5;boyoInitWalls();boyoSel=null;boyoDir=null;
      for (let r=-1;r<=boyoH;r++) for (let c=-1;c<=boyoW;c++) {
        if (((r+2)*31+(c+2)*17+${shape}*13)%19===0) {
          const key=r+','+c; if(boyoWalls.has(key))boyoWalls.delete(key);else boyoWalls.add(key);
        }
      }`);
    assert.equal(a.run('boyoCandidates().every(x => x.success && x.bounces <= 24 && x.path.length <= 241)'),true);
    assert.equal(a.run('!boyoCandidates().some(x => x.caught) || boyoCandidates()[0].caught'),true);
    a.check('boyoFeetOnly');
    assert.equal(a.run('boyoCandidates().every(x => x.caught)'),true);
    a.check('boyoFeetOnly',false);
  }
  a.run("for(let i=0;i<35;i++)boyoToggleWall(2,2)");
  assert.equal(a.run('boyoHistory.length'),30);
  a.run("boyoW=12;boyoResize('w',1)"); assert.equal(a.run('boyoW'),12);
  a.run("boyoH=1;boyoResize('h',-1)"); assert.equal(a.run('boyoH'),1);
});
