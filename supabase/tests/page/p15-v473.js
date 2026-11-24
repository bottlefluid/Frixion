// v4.73 in the page: Owner-only Game BOT across all 19 mini-games (strictly excluded from regular users, Co-Owners and
// /sfmode), Aim Trainer & Orb Sweeper bug fixes, and the 3 new easter eggs (making 90).
const { check, until, patch, wait } = T;
const hideModals = () => document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));

// ---------- 1. Non-Owner & Co-Owner CANNOT see or activate the BOT ----------
check('Air (regular user) logs in', await T.login('Air'));
hideModals();
openGame('snake');
const botBtn = () => gameWin && gameWin.querySelector('#fg-bot-btn');
gameBotSet(true);
check('v4.73: regular user cannot see or turn on the Game BOT',
  !!botBtn() && botBtn().classList.contains('hidden') && !gameBotAllowed() && !gameBotOn);
closeGame();

await patch('users/Sumi', { coowner: true });
check('Sumi (Co-Owner) logs in', await T.login('Sumi'));
hideModals();
openGame('snake');
check('v4.76 (request 91): Co-Owner CAN see and toggle the Game BOT',
  !!botBtn() && !botBtn().classList.contains('hidden') && gameBotAllowed());
gameBotToggle();
check('v4.76 (request 91): Co-Owner turns BOT ON cleanly', gameBotOn === true);
gameBotSet(false);
closeGame();
await patch('users/Sumi', { coowner: false, op: true });
await until(() => myProfile && !myProfile.coowner && myProfile.op === true, 5000);
openGame('snake');
gameBotToggle();
check('v4.76: Mod/OP still cannot see or turn on the Game BOT',
  !!botBtn() && botBtn().classList.contains('hidden') && !gameBotAllowed() && !gameBotOn);
closeGame();
await patch('users/Sumi', { op: false });

// ---------- 2. Owner sees the BOT, and /sfmode hides & stops it ----------
check('Tester (Owner) logs in', await T.login('Tester'));
await until(async () => Array.isArray((await doc('users/Tester')).ownedThemes), 6000);
hideModals();
openGame('snake');
check('v4.73: Owner sees the BOT button in the game bar',
  !!botBtn() && !botBtn().classList.contains('hidden') && gameBotAllowed() && !gameBotOn);
botBtn().click();
check('v4.73: clicking BOT turns it ON with active UI state',
  gameBotOn === true && botBtn().classList.contains('on') && /BOT: ON/i.test(botBtn().textContent));

// /sfmode immediately disables and hides the BOT
sfMode = true;
applyAdminVisibility();
check('v4.73: /sfmode immediately stops and hides the BOT',
  !gameBotOn && botBtn().classList.contains('hidden'));
sfMode = false;
applyAdminVisibility();
check('v4.73: leaving /sfmode restores the BOT button', !botBtn().classList.contains('hidden'));
closeGame();

// ---------- 2b. Human control lockout while BOT is ON, restored when OFF ----------
openGame('stack');
stStart();
stState.cur.x = 0; // far from center block -> manual Space drop would instantly Game Over!
botBtn().click();
const fgWinEl = gameWin.querySelector('.fg-window');
const stageEl = gameWin.querySelector('#game-stage');
check('lockout: .fg-window gets .bot-on, #game-stage is inert and pointer-events:none while BOT is on',
  fgWinEl.classList.contains('bot-on') && stageEl.inert === true && getComputedStyle(stageEl).pointerEvents === 'none');
const spEvt = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
window.dispatchEvent(spEvt);
check('lockout: Space key is blocked while Stack Tower BOT is on (no accidental topple)',
  spEvt.defaultPrevented && stState.running && !stState.over);
// Turning BOT OFF via the bar button immediately restores manual control
botBtn().click();
check('lockout: turning BOT OFF removes .bot-on, clears inert and restores pointer-events on #game-stage',
  !gameBotOn && !fgWinEl.classList.contains('bot-on') && stageEl.inert === false && getComputedStyle(stageEl).pointerEvents !== 'none');
stState.cur.x = stState.blocks[0].x;
const blocksBefore = stState.blocks.length;
document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
check('lockout: after turning BOT OFF, manual Space drop works immediately',
  stState.blocks.length === blocksBefore + 1);
closeGame();

// Typing Sprint input focus is blocked & blurred while BOT is ON
openGame('typing');
tsStart();
const tsInp = $('ts-input');
tsInp.focus();
gameBotSet(true);
const focusAttempt = (tsInp.focus(), document.activeElement === tsInp);
check('lockout: #ts-input is blurred and refuses focus while BOT is ON', !focusAttempt);
closeGame();

// ---------- 3. Verify all 19 games auto-play accurately ----------
// Daily Word: solved in 1 guess
openGame('dailyword');
gameBotSet(true);
check('BOT Daily Word: solves in 1 guess', !!(await until(() => dwState && dwState.done === 'win' && dwState.rows.length === 1, 6000)), dwState && { done: dwState.done, rows: dwState.rows });
closeGame();

// Sudoku: solved completely & valid
openGame('sudoku');
gameBotSet(true);
check('BOT Sudoku: solves full board with 0 errors', !!(await until(() => suState && suState.done === 'win' && suValid(suState.cells), 8000)));
closeGame();

// Memory Match: clears all 8 pairs in exact minimum 8 moves
openGame('memory');
gameBotSet(true);
check('BOT Memory Match: clears in exact 8 moves (100% accuracy)', !!(await until(() => mmState && mmState.done && mmState.moves === 8, 6000)), mmState && { done: mmState.done, moves: mmState.moves });
closeGame();

// Orb Sweeper: clears full board without hitting a mine (+ HTML win message)
openGame('sweeper');
gameBotSet(true);
check('BOT Orb Sweeper: wins with 0 mines hit and formatted Orbs icon', !!(await until(() => csState && csState.over && csState.win && $('cs-msg').querySelector('.orb-ic'), 8000)));
closeGame();

// Connect Four: beats Reed
openGame('connect4');
gameBotSet(true);
check('BOT Connect Four: defeats Reed', !!(await until(() => c4State && c4State.over && c4Wins(c4State.board, 1), 15000)), c4State && { over: c4State.over, status: $('c4-status') && $('c4-status').textContent });
closeGame();

// Orb Crush: plays high-scoring matches
openGame('crush');
gameBotSet(true);
check('BOT Orb Crush: makes optimal swaps and scores', !!(await until(() => crState && crState.score >= 60 && crState.moves <= 18, 6000)), crState && { score: crState.score, moves: crState.moves });
closeGame();

// X-tra Math: picks Level 6 Calculus and maintains 100% streak
openGame('xtramath');
gameBotSet(true);
check('BOT X-tra Math: picks Level 6 and solves with 100% streak', !!(await until(() => xtraState && xtraState.level && xtraState.level.lv === 6 && xtraState.solved >= 3 && xtraState.streak === xtraState.solved, 8000)), xtraState && { solved: xtraState.solved, streak: xtraState.streak });
closeGame();

// Typing Sprint: clears flying words with 3/3 lives
openGame('typing');
gameBotSet(true);
check('BOT Typing Sprint: clears words with 0 lives lost', !!(await until(() => tsState && tsState.cleared >= 2 && tsState.lives === 3, 8000)), tsState && { cleared: tsState.cleared, lives: tsState.lives });
closeGame();

// Aim Trainer: rapid hits at 100% accuracy + end screen has no ReferenceError
openGame('aim');
gameBotSet(true);
const aimOk = !!(await until(() => atState && atState.hits >= 15 && atState.misses === 0, 5000));
atEnd();
check('BOT Aim Trainer: 100% accuracy hits and clean end screen', aimOk && $('at-overlay').style.display === 'flex' && /Orbs/.test($('at-overlay').textContent), atState && { hits: atState.hits, misses: atState.misses });
closeGame();

// Cookie Clicker: turbo clicks + auto-buys buildings
const ckBefore = UC.cookieClicks || 0;
openGame('cookie');
gameBotSet(true);
check('BOT Cookie Clicker: turbo-clicks and auto-buys buildings', !!(await until(() => (UC.cookieClicks || 0) >= ckBefore + 40 && Object.values(UC.cookieBuildings || {}).reduce((a, b) => a + b, 0) >= 1, 5000)), { clicks: UC.cookieClicks, blds: UC.cookieBuildings });
closeGame();

// Grow a Garden: plants plots automatically
openGame('growgarden');
gameBotSet(true);
check('BOT Grow a Garden: auto-plants unlocked plots with best seeds', !!(await until(() => (UC.ggPlots || []).filter(Boolean).length >= 2, 5000)), UC.ggPlots);
closeGame();

// Liquid Dash: survives obstacles cleanly
openGame('geodash');
gameBotSet(true);
check('BOT Liquid Dash: dodges spikes without dying', !!(await until(() => gdState && gdState.running && !gdState.dead && gdState.score >= 90, 8000)), gdState && { score: gdState.score, mode: gdState.mode, dead: gdState.dead });
closeGame();

// Snake: eats 20+ Orbs on Hamiltonian + shortcut solver without dying (even while spamming bad keys!)
openGame('snake');
gameBotSet(true);
for (let k = 0; k < 8; k++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', bubbles: true, cancelable: true }));
check('BOT Snake: eats 20+ Orbs immortally while ignoring human keys', !!(await until(() => snakeState && snakeState.alive && snakeState.eaten >= 20, 15000)), snakeState && { eaten: snakeState.eaten, alive: snakeState.alive });
closeGame();

// Blox Merge (2048): rapidly merges tiles
openGame('merge');
gameBotSet(true);
check('BOT Blox Merge: plays fast and builds tiles', !!(await until(() => mergeState && mergeState.score >= 120 && mergeState.highest >= 32, 6000)), mergeState && { score: mergeState.score, highest: mergeState.highest });
closeGame();

// Block Blast (Tetris): 2-ply Dellacherie places pieces & clears lines cleanly without topping out
openGame('blockblast');
gameBotSet(true);
check('BOT Block Blast: places pieces & clears lines with 0 top-outs', !!(await until(() => bbState && bbState.running && !bbState.over && bbState.lines >= 1, 8000)), bbState && { lines: bbState.lines, score: bbState.score, over: bbState.over });
closeGame();

// Stack Tower: 100% pixel-perfect stack (zero width lost)
openGame('stack');
gameBotSet(true);
check('BOT Stack Tower: stacks with 100% exact alignment (0px lost)', !!(await until(() => stState && stState.running && stState.blocks.length >= 4 && stState.blocks[stState.blocks.length - 1].w === stState.blocks[0].w, 15000)), stState && { h: stState.blocks.length - 1, w0: stState.blocks[0] && stState.blocks[0].w, wn: stState.blocks[stState.blocks.length - 1] && stState.blocks[stState.blocks.length - 1].w });
closeGame();

// Brick Breaker: tracks ball and breaks bricks with 3/3 lives
openGame('brick');
gameBotSet(true);
check('BOT Brick Breaker: intercepts ball and breaks bricks with 3/3 lives', !!(await until(() => bkState && bkState.running && bkState.score >= 20 && bkState.lives === 3, 8000)), bkState && { score: bkState.score, lives: bkState.lives });
closeGame();

// Color Simon: repeats sequences accurately
openGame('simon');
gameBotSet(true);
check('BOT Color Simon: clears rounds accurately', !!(await until(() => smState && !smState.over && smState.round >= 2, 8000)), smState && { round: smState.round, over: smState.over });
closeGame();

// Mouse Maze: clears level 1 flawlessly with 0 deaths while ignoring human mouse input
openGame('maze');
await until(() => mazeMod, 5000);
const mz = await mazeMod;
await wait(250);
gameBotSet(true);
document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5, movementX: 900, movementY: 900, bubbles: true }));
check('BOT Mouse Maze: clears level 1 flawlessly with 0 deaths (ignoring human mouse)', !!(await until(() => (UC.mazeBest || 0) >= 1 && mz._peek().deaths === 0, 10000)), { best: UC.mazeBest, peek: mz._peek() });
closeGame();
check('v4.73: closing a game cleanly turns BOT off', !gameBotOn);

// ---------- 4. The 3 new v4.73 easter eggs (making 90) ----------
check('egg: Arcade Regular (opened 5+ different mini-games in one visit)', !!(await until(() => eggFoundSet.has('arcadepro'), 6000)));
if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
for (const word of ['autopilot', 'beepboop']) {
  for (const ch of word) document.dispatchEvent(new KeyboardEvent('keydown', { key: ch, code: 'Key' + ch.toUpperCase(), bubbles: true }));
}
check('egg: Autopilot and Beep Boop (typed anywhere)', !!(await until(() => eggFoundSet.has('autopilot') && eggFoundSet.has('beepboop'), 6000)));
check('v4.73: EGGS has at least 90 eggs and Game Bot (v4.73) is in EGG_GROUPS',
  EGGS.length >= 90 && EGG_GROUPS.some(([name, ids]) => /v4\.73/.test(name) && ids.join() === 'autopilot,beepboop,arcadepro'),
  EGGS.length);

return T.report();
