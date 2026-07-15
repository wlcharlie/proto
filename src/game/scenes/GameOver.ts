import { Scene } from 'phaser';
import { run, startNewRun } from '../run';
import { loadSave } from '../save';
import { DPR, label, makeButton } from '../ui';

export class GameOver extends Scene {
    constructor() {
        super('GameOver');
    }

    create() {
        this.cameras.main.setZoom(DPR).centerOn(512, 384); // Retina:見 game/main.ts

        const save = loadSave(); // 獎勵點已在潰滅當下入庫(Game.shatter)

        label(this, 512, 176, '遠 征 潰 滅', 54, '#ff5c5c', 0.5).setFontStyle('bold');
        label(this, 512, 230, '小隊全滅,詛咒吞沒了戰線 —— 這次遠征到此為止。', 15, '#8a93a6', 0.5);

        const g = this.add.graphics();
        g.fillStyle(0x161d29, 1);
        g.fillRoundedRect(332, 288, 360, 192, 14);
        g.lineStyle(2, 0x3c5a80, 1);
        g.strokeRoundedRect(332, 288, 360, 192, 14);

        label(this, 372, 334, '推進到', 16, '#8a93a6');
        label(this, 652, 334, `第 ${run.level} 關`, 18, '#e8ecf4', 1);
        label(this, 372, 384, '轟破之門', 16, '#8a93a6');
        label(this, 652, 384, `${run.level - 1} 道`, 18, '#e8ecf4', 1);
        label(this, 372, 434, '獎勵點結算', 16, '#8a93a6');
        label(this, 652, 434, `+${run.level - 1} → 庫存 ${save.points}`, 18, '#ffd35c', 1);

        makeButton(this, 398, 556, '局外解鎖(主選單)', () => this.scene.start('MainMenu'), { w: 232, h: 52 });
        makeButton(this, 642, 556, '再次遠征 ↻', () => {
            startNewRun(loadSave());
            this.scene.start('Game');
        }, { w: 190, h: 52, fill: 0x1f3a2a, stroke: 0x4a8a5a });
    }
}
