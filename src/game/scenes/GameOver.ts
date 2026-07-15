import { Scene } from 'phaser';
import { run, startNewRun } from '../run';
import { loadSave } from '../save';
import { label, makeButton } from '../ui';

export class GameOver extends Scene {
    constructor() {
        super('GameOver');
    }

    create() {
        const save = loadSave(); // 獎勵點已在碎裂當下入庫(Game.shatter)

        label(this, 512, 176, '裝 置 碎 裂', 54, '#ff5c5c', 0.5).setFontStyle('bold');
        label(this, 512, 230, '輿圖裝置承受不住反噬,這一輪到此為止。', 15, '#8a93a6', 0.5);

        const g = this.add.graphics();
        g.fillStyle(0x161d29, 1);
        g.fillRoundedRect(332, 288, 360, 192, 14);
        g.lineStyle(2, 0x3c5a80, 1);
        g.strokeRoundedRect(332, 288, 360, 192, 14);

        label(this, 372, 334, '此輪到達', 16, '#8a93a6');
        label(this, 652, 334, `第 ${run.level} 關`, 18, '#e8ecf4', 1);
        label(this, 372, 384, '征服異界', 16, '#8a93a6');
        label(this, 652, 384, `${run.conquered} 座`, 18, '#e8ecf4', 1);
        label(this, 372, 434, '獎勵點結算', 16, '#8a93a6');
        label(this, 652, 434, `+${run.conquered} → 庫存 ${save.points}`, 18, '#ffd35c', 1);

        makeButton(this, 398, 556, '局外解鎖(主選單)', () => this.scene.start('MainMenu'), { w: 232, h: 52 });
        makeButton(this, 642, 556, '再來一輪 ↻', () => {
            startNewRun(loadSave());
            this.scene.start('Game');
        }, { w: 190, h: 52, fill: 0x1f3a2a, stroke: 0x4a8a5a });
    }
}
