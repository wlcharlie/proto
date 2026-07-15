import StartGame from './game/main';

document.addEventListener('DOMContentLoaded', () => {

    // 除錯用把手:在瀏覽器 console 可透過 __game 檢視場景狀態(原型期方便調參)
    (window as unknown as { __game: Phaser.Game }).__game = StartGame('game-container');

});
