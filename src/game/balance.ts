// 所有調參旋鈕集中在這裡,對應 GDD「核心機制」的暫定數值。
// GDD 的 🔴 待決「節奏味道」此原型採「快循環」版:基數砍到 20(GDD 節奏待拍一節的建議),
// 產速/抵抗也同步上調,目標是單門數十秒、單關 2~4 分鐘。要回「慢經營」把 BASE 調回 100、
// MAKER_PERIOD 調回 2.0、DOOR_DRAIN 調回 1.0 即可。

export const BAL = {
    // --- 傳送門軸(GDD:四狀態比例 -3 / -1 / 0 / +3 × 基數) ---
    BASE: 20,               // 基數(GDD 暫定 100;快循環版 20)
    STABLE_RATIO: 3,        // +3 → 穩定・鎖定
    BACKLASH_RATIO: -1,     // -1 → 開始反噬(敵方湧出)
    COLLAPSE_RATIO: -3,     // -3 → 崩潰(失敗 +1)

    // --- 生產與抵抗 ---
    MAKER_PERIOD: 0.8,      // 異界產速:每 N 秒 1 隻(GDD 2 秒/隻;快循環版加速)
    DOOR_DRAIN: 1.2,        // 門抵抗:進度每秒流失(GDD -1/s)
    DRAIN_PER_LEVEL: 0.1,   // 每過一關,門抵抗成長(GDD 待決:反噬強度隨關卡升高 → 先做溫和版)
    DRAIN_MAX: 2.0,

    // --- 單位 ---
    UNIT_VALUE: 1,          // 我方單位基準貢獻(GDD 暫定 1)
    ENEMY_VALUE: 1,         // 敵方單位數值(GDD 暫定 -1,取絕對值)
    ENEMY_PERIOD: 2.0,      // 反噬時每 N 秒湧出 1 隻(輪流沿各條連線)
    ENEMY_PERIOD_MIN: 1.2,
    ENEMY_PERIOD_PER_LEVEL: 0.1,
    UNIT_SPEED: 100,        // px/s,單位與敵人同速

    // --- 單位的一生(GDD:貢獻=戰力,同一個池) ---
    PASS_MULT: 0.4,         // 過門打 4 折(GDD 範例值)
    CULL_VALUE: 0.1,        // 貢獻低於此 → 榨乾,移除
    MATCH_MIN_W: 0.2,       // 規格完全不符時的貢獻權重(GDD:仍有貢獻但低很多)

    // --- 裂隙出現節奏(傳送門隨機位置、分批撕開) ---
    RIFT_FIRST: 5,          // 第一道裂隙開始預告的時間(秒)
    RIFT_GAP: 22,           // 之後每道裂隙的間隔基準(秒;隨關數壓縮)
    RIFT_JITTER: 6,         // 間隔的隨機抖動 ±N 秒
    RIFT_LEAD: 4,           // 預告時間:裂隙標記出現 → 門實際撕開
    RIFT_DOOR_DIST: 3,      // 新裂隙與既有門/預告的最小距離(Chebyshev 格數)
    RIFT_MAKER_DIST: 2,     // 新裂隙與異界的最小距離

    // --- 佈局 ---
    MAX_ROUTES_PER_MAKER: 2, // MVP 分流:每座異界最多 2 條產線、輪流均分(GDD)
    DRAW_MAX_CELLS: 60,      // 手繪產線的長度上限(格)

    // --- 關卡(部署上限 = min(DEPLOY_MAX, 2 + 關數),代理 GDD 的「場地空間有限」約束) ---
    DEPLOY_MAX: 6,
};
