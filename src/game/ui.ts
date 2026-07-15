// 輕量 UI 工具:目前零美術素材,全部用 Graphics + Text 畫。

import { GameObjects, Scene } from 'phaser';

export const FONT = '"PingFang TC", "Heiti TC", "Microsoft JhengHei", "Noto Sans TC", system-ui, sans-serif';

export function label(
    scene: Scene, x: number, y: number, str: string, size: number, color: string,
    originX = 0, originY = 0.5,
): GameObjects.Text {
    return scene.add.text(x, y, str, { fontFamily: FONT, fontSize: size, color }).setOrigin(originX, originY);
}

export interface ButtonOpts {
    w?: number;
    h?: number;
    fontSize?: number;
    color?: string;
    fill?: number;
    stroke?: number;
}

export function makeButton(
    scene: Scene, x: number, y: number, text: string, onClick: () => void, opts: ButtonOpts = {},
): GameObjects.Container {
    const w = opts.w ?? 220;
    const h = opts.h ?? 48;
    const fill = opts.fill ?? 0x1c2c40;
    const stroke = opts.stroke ?? 0x3c5a80;

    const cont = scene.add.container(x, y);
    const g = scene.add.graphics();
    const draw = (hover: boolean) => {
        g.clear();
        g.fillStyle(fill, 1);
        g.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        if (hover) {
            g.fillStyle(0xffffff, 0.08);
            g.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
        }
        g.lineStyle(2, stroke, 1);
        g.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    };
    draw(false);

    const t = scene.add.text(0, 1, text, {
        fontFamily: FONT, fontSize: opts.fontSize ?? 19, color: opts.color ?? '#e8ecf4',
    }).setOrigin(0.5);

    const z = scene.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
    z.on('pointerover', () => draw(true));
    z.on('pointerout', () => draw(false));
    z.on('pointerdown', () => onClick());

    cont.add([g, t, z]);
    return cont;
}
