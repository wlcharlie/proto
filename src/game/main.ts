import { AUTO, Game, Scale } from 'phaser';
import { Game as MainGame } from './scenes/Game';
import { GameOver } from './scenes/GameOver';
import { MainMenu } from './scenes/MainMenu';
import { DPR } from './ui';

// 全程式繪製(Graphics + Text),目前沒有外部素材,因此不需要 Boot/Preloader 載入鏈。
// 第一個場景自動啟動:MainMenu。
//
// Retina 對策:canvas 實體尺寸 = 1024×768 × DPR,各場景鏡頭 setZoom(DPR).centerOn(512, 384),
// 邏輯座標空間維持 1024×768 —— 場景內寫死的座標不受影響。
const config: Phaser.Types.Core.GameConfig = {
    type: AUTO,
    width: 1024 * DPR,
    height: 768 * DPR,
    parent: 'game-container',
    backgroundColor: '#0b0e13',
    scale: {
        mode: Scale.FIT,
        autoCenter: Scale.CENTER_BOTH,
    },
    scene: [
        MainMenu,
        MainGame,
        GameOver,
    ],
};

const StartGame = (parent: string) => {

    return new Game({ ...config, parent });

};

export default StartGame;
