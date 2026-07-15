import { Scene } from 'phaser';
import { BAL } from '../balance';
import { startNewRun } from '../run';
import { UNLOCKS, buy, canBuy, clearSave, hasUnlock, loadSave, persistSave } from '../save';
import { DPR, label, makeButton } from '../ui';

export class MainMenu extends Scene {
    private wipeArmed = false;

    constructor() {
        super('MainMenu');
    }

    create() {
        this.cameras.main.setZoom(DPR).centerOn(512, 384); // Retina:見 game/main.ts

        const save = loadSave();
        this.wipeArmed = false;

        label(this, 512, 82, '異界魔王', 52, '#e8ecf4', 0.5).setFontStyle('bold');
        label(this, 512, 128, 'R I F T L O R D · 原型 v0.5「詛咒行軍」', 15, '#8a93a6', 0.5);
        label(this, 512, 166, '護送小隊穿過詛咒戰場,轟開一道道異界之門 —— HP 是唯一的貨幣。', 15, '#aab3c6', 0.5);

        // 左欄:遠征配置(局外解鎖的效果總覽)
        label(this, 150, 226, '遠征配置', 18, '#e8ecf4');
        const rows: [string, string][] = [
            ['起始小隊', `${BAL.SQUAD_START + (hasUnlock(save, 'start-squad') ? 1 : 0)} 名`],
            ['開局魔力', `✦ ${BAL.MANA_START + (hasUnlock(save, 'start-mana') ? 50 : 0)}`],
            ['開局技能點', `${hasUnlock(save, 'start-skill') ? 1 : 0} 點`],
        ];
        rows.forEach(([k, v], i) => {
            const y = 268 + i * 58;
            const g = this.add.graphics();
            g.fillStyle(0x161d29, 1);
            g.fillRoundedRect(150, y - 24, 300, 48, 10);
            g.lineStyle(2, 0x3c5a80, 0.9);
            g.strokeRoundedRect(150, y - 24, 300, 48, 10);
            label(this, 170, y, k, 15, '#aab3c6');
            label(this, 430, y, v, 17, '#e8ecf4', 1);
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

        makeButton(this, 512, 556, '開始遠征 ▶', () => {
            startNewRun(save);
            this.scene.start('Game');
        }, { w: 280, h: 58, fontSize: 22, fill: 0x1f3a2a, stroke: 0x4a8a5a });

        label(this, 512, 626, '單位走到門 = 貢獻傷害並賺取魔力,之後從泉水折半復活;死在路上 = 永久死亡。', 13, '#8a93a6', 0.5);
        label(this, 512, 648, '魔力:蓋站/升級/補員。門破 = 過關 +1 技能點;全滅(且補不起員)= 遠征結束,結算局外點。', 13, '#8a93a6', 0.5);
        label(this, 512, 684, '操作:點卡片蓋站(蓋在產線上才生效)|點回復站升級|✕ 拆除退一半|空白鍵 暫停|1 / 2 調速', 13, '#5f89b8', 0.5);

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
