import { Scene } from 'phaser';
import { startNewRun } from '../run';
import { UNLOCKS, buy, canBuy, clearSave, hasUnlock, loadSave, persistSave } from '../save';
import { TRAIT_EMOJI, startingLineup } from '../types';
import { label, makeButton } from '../ui';

export class MainMenu extends Scene {
    private wipeArmed = false;

    constructor() {
        super('MainMenu');
    }

    create() {
        const save = loadSave();
        this.wipeArmed = false;

        label(this, 512, 82, '異界魔王', 52, '#e8ecf4', 0.5).setFontStyle('bold');
        label(this, 512, 128, 'R I F T L O R D · 原型 v0.1', 15, '#8a93a6', 0.5);
        label(this, 512, 166, '開啟傳送門,把產線鋪向異界征服它 —— 疏於照顧,產線瞬間變戰線。', 15, '#aab3c6', 0.5);

        // 左欄:起始陣容
        const lineup = startingLineup(hasUnlock(save, 'world-beast'));
        label(this, 150, 226, `起始陣容(${lineup.length})`, 18, '#e8ecf4');
        lineup.forEach((w, i) => {
            const y = 268 + i * 58;
            const g = this.add.graphics();
            g.fillStyle(0x161d29, 1);
            g.fillRoundedRect(150, y - 24, 300, 48, 10);
            g.lineStyle(2, w.color, 0.9);
            g.strokeRoundedRect(150, y - 24, 300, 48, 10);
            label(this, 170, y, w.name, 17, '#e8ecf4');
            label(this, 430, y, w.traits.map(t => TRAIT_EMOJI[t]).join(' '), 18, '#e8ecf4', 1);
        });

        // 右欄:局外解鎖
        label(this, 570, 226, '局外解鎖', 18, '#e8ecf4');
        label(this, 874, 226, `獎勵點:${save.points}`, 17, '#ffd35c', 1);
        UNLOCKS.forEach((u, i) => {
            const y = 274 + i * 76;
            const owned = hasUnlock(save, u.id);
            const g = this.add.graphics();
            g.fillStyle(0x161d29, 1);
            g.fillRoundedRect(570, y - 31, 304, 64, 10);
            g.lineStyle(1.5, owned ? 0x4a5568 : 0x3c5a80, 1);
            g.strokeRoundedRect(570, y - 31, 304, 64, 10);
            label(this, 588, y - 13, u.name, 15, owned ? '#8a93a6' : '#e8ecf4');
            label(this, 588, y + 13, u.desc, 12, '#8a93a6');
            if (owned) {
                label(this, 858, y, '✓ 已解鎖', 14, '#7dd87d', 1);
            } else if (canBuy(save, u)) {
                makeButton(this, 812, y, `${u.cost} 點解鎖`, () => {
                    buy(save, u);
                    persistSave(save);
                    this.scene.restart();
                }, { w: 100, h: 36, fontSize: 13 });
            } else {
                const hint = u.requires && !hasUnlock(save, u.requires) ? '需前置' : `需 ${u.cost} 點`;
                label(this, 858, y, hint, 13, '#5c6577', 1);
            }
        });

        makeButton(this, 512, 556, '開始新的一輪 ▶', () => {
            startNewRun(save);
            this.scene.start('Game');
        }, { w: 280, h: 58, fontSize: 22, fill: 0x1f3a2a, stroke: 0x4a8a5a });

        label(this, 512, 626, '一輪 = 一顆輿圖裝置的旅程:每關穩定所有傳送門即過關,征服的異界成為你的新產線。', 13, '#8a93a6', 0.5);
        label(this, 512, 648, '傳送門崩潰會折損裝置完整度;完整度耗盡 → 裝置碎裂,結算獎勵點做局外解鎖。', 13, '#8a93a6', 0.5);
        label(this, 512, 684, '操作:點卡片放異界與泉水|從源頭按住拖曳畫線到門|點線段拆除|空白鍵 戰術暫停|1 / 2 調速', 13, '#5f89b8', 0.5);

        const wipe = label(this, 1000, 744, '清除存檔', 12, '#5c6577', 1).setInteractive({ useHandCursor: true });
        wipe.on('pointerdown', () => {
            if (!this.wipeArmed) {
                this.wipeArmed = true;
                wipe.setText('確定清除?').setColor('#ff5c5c');
                this.time.delayedCall(2500, () => {
                    this.wipeArmed = false;
                    wipe.setText('清除存檔').setColor('#5c6577');
                });
            } else {
                clearSave();
                this.scene.restart();
            }
        });
    }
}
