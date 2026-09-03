import { describe, it, expect } from "vitest";
import {
  azimuthLabel,
  heightPartLabel,
  pitchLabel,
  describeCamera,
  describeCameraMove,
  mergeStartFrameDesc,
  extractPurpose,
  buildCameraDirection,
  buildPrevizWriteback,
} from "@/lib/previz/describe";
import {
  defaultCamera,
  distanceForShotSize,
  type CameraRig,
  type PrevizBlocking,
  type PrevizScene,
} from "@/lib/previz/stage-types";

const SCENE: PrevizScene = {
  version: 1,
  blocks: [],
  figures: [
    { id: "f1", characterId: "c1", name: "角色甲", height: 1.7, color: "#888" },
    { id: "f2", characterId: "c2", name: "角色乙", height: 1.2, color: "#999" },
  ],
};

const PLACEMENTS = [
  { figureId: "f1", x: 0, z: 0, rotY: 0, pose: "stand" as const },
  { figureId: "f2", x: 1, z: 0, rotY: 0, pose: "stand" as const },
];

function rig(over: Partial<CameraRig> = {}): CameraRig {
  return { ...defaultCamera("f1"), ...over };
}

describe("azimuthLabel", () => {
  it.each([
    [0, "正前方"],
    [20, "正前方"],
    [45, "右前方"],
    [-45, "左前方"],
    [90, "正右侧"],
    [-90, "正左侧"],
    [135, "右后方"],
    [180, "正后方"],
    [-180, "正后方"],
  ])("%s° → %s", (deg, label) => {
    expect(azimuthLabel(deg)).toBe(label);
  });

  it("超出 ±180 的角度先归一化，不会掉进兜底档", () => {
    expect(azimuthLabel(360)).toBe("正前方");
    expect(azimuthLabel(405)).toBe("右前方");
    expect(azimuthLabel(-315)).toBe("右前方");
  });
});

describe("heightPartLabel", () => {
  it("按相机离地高度 ÷ 身高分档", () => {
    expect(heightPartLabel(1.6, 1.7)).toBe("眼睛");
    expect(heightPartLabel(1.2, 1.7)).toBe("胸口");
    expect(heightPartLabel(0.5, 1.7)).toBe("膝盖");
    expect(heightPartLabel(0.1, 1.7)).toBe("地面");
    expect(heightPartLabel(2.2, 1.7)).toBe("头顶以上");
  });

  it("儿童身高下同一个物理高度会落到更高的部位", () => {
    // 1.2 米的机位对成人是胸口，对 1.2 米高的孩子就是头顶
    expect(heightPartLabel(1.2, 1.7)).toBe("胸口");
    expect(heightPartLabel(1.2, 1.2)).toBe("眼睛");
  });
});

describe("pitchLabel", () => {
  it("由俯仰角决定，不由机位高低决定", () => {
    // 架得高但看向同样高度 = 平视
    expect(pitchLabel(rig({ height: 2.5, targetHeight: 2.5, distance: 3 }))).toBe("平视");
    expect(pitchLabel(rig({ height: 2.5, targetHeight: 1.2, distance: 2 }))).toBe("俯拍");
    expect(pitchLabel(rig({ height: 0.4, targetHeight: 1.6, distance: 2 }))).toBe("仰拍");
  });
});

describe("describeCamera", () => {
  it("景别与距离永远自洽 —— 按近景距离摆位就一定写出近景", () => {
    const d = distanceForShotSize("closeUp", 1.7, 40);
    const desc = describeCamera(rig({ distance: d, fov: 40 }), SCENE, PLACEMENTS);
    expect(desc.shotSize).toBe("closeUp");
    expect(desc.framing).toContain("近景");
    expect(desc.framing).toContain("取景胸口以上");
  });

  it("要素 1 的格式符合约定 14", () => {
    const desc = describeCamera(
      rig({ distance: 1.5, azimuthDeg: 0, height: 1.2, targetHeight: 1.2 }),
      SCENE,
      PLACEMENTS
    );
    expect(desc.position).toBe("摄影机在角色甲正前方约1.5米，镜头高度胸口平视");
  });

  it("主体被删掉时回落到在场演员，而不是抛错", () => {
    const desc = describeCamera(rig({ subjectFigureId: "gone" }), SCENE, PLACEMENTS);
    expect(desc.subjectName).toBe("角色甲");
  });

  it("空场景仍给得出一句话", () => {
    const desc = describeCamera(rig({ subjectFigureId: null }), { version: 1, blocks: [], figures: [] }, []);
    expect(desc.position).toContain("画面中心");
  });
});

describe("mergeStartFrameDesc —— 只换前两个子句", () => {
  const desc = describeCamera(
    rig({ distance: 1.5, height: 1.2, targetHeight: 1.2 }),
    SCENE,
    PLACEMENTS
  );

  it("五要素齐全时，光影与情绪子句原样保留", () => {
    const existing =
      "摄影机在角色甲正前方约3米，镜头高度腰部仰拍；" +
      "全景仰拍，取景全身；" +
      "角色甲站在画面左三分之一，左手扶额；" +
      "左侧柔和月光冷蓝侧逆光均匀铺洒，轮廓光勾勒肩线；" +
      "嘴角绷紧眼眸下垂——书房烛光";
    const merged = mergeStartFrameDesc(existing, desc);
    const clauses = merged.split("；");
    expect(clauses).toHaveLength(5);
    expect(clauses[0]).toBe(desc.position);
    expect(clauses[1]).toBe(desc.framing);
    expect(clauses[2]).toContain("左手扶额");
    expect(clauses[3]).toContain("月光");
    expect(clauses[4]).toContain("书房烛光");
  });

  it("旧数据缺第一要素（只有景别）时是插入而不是覆盖景别", () => {
    const existing = "近景平视，取景胸口以上；角色甲站在画面中央；顶光自上方洒下";
    const merged = mergeStartFrameDesc(existing, desc);
    const clauses = merged.split("；");
    expect(clauses[0]).toBe(desc.position);
    expect(clauses[1]).toBe(desc.framing);
    // 原来那句景别被识别成要素 2 并替换掉，姿态与光影仍在
    expect(clauses[2]).toContain("画面中央");
    expect(clauses[3]).toContain("顶光");
  });

  it("完全没有机位也没有景别时，两句都插到最前面，一句原文都不丢", () => {
    const existing = "角色甲站在门口；暖调台灯自右侧照亮侧脸";
    const merged = mergeStartFrameDesc(existing, desc);
    const clauses = merged.split("；");
    expect(clauses).toEqual([desc.position, desc.framing, "角色甲站在门口", "暖调台灯自右侧照亮侧脸"]);
  });

  /**
   * 真实库里**每一条** startFrameDesc 都是这个形状：景别和角色走位挤在同一个子句里。
   * 按"含景别词就整句替换"去做会把整段走位删掉 —— 这条测试就是为了锁住这件事。
   */
  it("景别与走位混写在同一句时，只换景别词，走位一个字都不丢", () => {
    // 特意用一个算出来不是「中景」的机位，才能看出景别词确实被换掉了
    const closeUp = describeCamera(
      rig({ distance: distanceForShotSize("closeUp", 1.7, 40), fov: 40 }),
      SCENE,
      PLACEMENTS
    );
    const existing =
      "中景平视，角色甲位于画面右侧偏后位置面朝画面左下方俯视、右脚前跨左膝微弯呈半蹲预备姿态、" +
      "左手垂于体侧右手扶在腰侧刀柄上；" +
      "篝火橙红侧光从画面右上方漫射下来；" +
      "角色甲眉心微蹙咬肌松放；镇北废墟街巷角落";
    const merged = mergeStartFrameDesc(existing, closeUp);
    const clauses = merged.split("；");

    expect(clauses[0]).toBe(closeUp.position);
    // 景别词换成新的，逗号之后的走位原样保留
    expect(clauses[1].startsWith(closeUp.sizeWithPitch)).toBe(true);
    expect(clauses[1]).toContain("右脚前跨左膝微弯呈半蹲预备姿态");
    expect(clauses[1]).toContain("右手扶在腰侧刀柄上");
    expect(clauses[1]).not.toContain("中景平视");
    // 后面三句一字未动
    expect(clauses.slice(2)).toEqual(["篝火橙红侧光从画面右上方漫射下来", "角色甲眉心微蹙咬肌松放", "镇北废墟街巷角落"]);
  });

  it("景别词不在句首（'侧面中景'/'极近特写平视'）也能就地替换", () => {
    for (const head of ["侧面中景", "极近特写平视", "中远景平视", "远景微仰角"]) {
      const merged = mergeStartFrameDesc(`${head}，角色甲位于画面左侧、双足交替离地`, desc);
      const clauses = merged.split("；");
      expect(clauses[1].startsWith(desc.sizeWithPitch)).toBe(true);
      expect(clauses[1]).toContain("双足交替离地");
      expect(clauses[1]).not.toContain(head);
    }
  });

  it("三种合并方式都在计算依据里说清楚了", () => {
    const blocking: PrevizBlocking = { version: 1, camera: rig({ distance: 1.5 }), placements: PLACEMENTS };
    const call = (existing: string | null) =>
      buildPrevizWriteback({ scene: SCENE, blocking, duration: 5, existingStartFrameDesc: existing })
        .notes.join(" ");
    expect(call("近景平视，取景胸口以上；角色甲低头")).toContain("整句换");
    expect(call("中景平视，角色甲位于画面左侧、低头")).toContain("走位描述一字未动");
    expect(call("角色甲低头；顶光")).toContain("没写景别");
  });

  it("空的 startFrameDesc 只产出两个子句（剩下三个要素留给用户/批量重写）", () => {
    expect(mergeStartFrameDesc("", desc).split("；")).toHaveLength(2);
    expect(mergeStartFrameDesc(null, desc).split("；")).toHaveLength(2);
  });

  it("半角分号与多余空白也能正确切分", () => {
    const merged = mergeStartFrameDesc("摄影机在旧位置; 中景平视，取景腰部以上 ; 角色甲抬头", desc);
    expect(merged.split("；")).toEqual([desc.position, desc.framing, "角色甲抬头"]);
  });
});

describe("describeCameraMove", () => {
  const base = rig({ distance: 4, azimuthDeg: 0, height: 1.6, fov: 40 });

  it("没动就是固定镜头（拖拽抖动不算运动）", () => {
    const move = describeCameraMove(base, { ...base, distance: 4.1, azimuthDeg: 3 }, 5);
    expect(move.hasMotion).toBe(false);
    expect(move.phrase).toBe("固定镜头");
  });

  it("距离变小 = 推近，变大 = 拉远", () => {
    expect(describeCameraMove(base, { ...base, distance: 1.5 }, 5).phrase).toContain("推近");
    expect(describeCameraMove(base, { ...base, distance: 9 }, 5).phrase).toContain("拉远");
  });

  it("环绕带方向和角度", () => {
    expect(describeCameraMove(base, { ...base, azimuthDeg: 90 }, 5).phrase).toContain("绕向主体右侧环绕90°");
    expect(describeCameraMove(base, { ...base, azimuthDeg: -60 }, 5).phrase).toContain("绕向主体左侧环绕60°");
  });

  it("环绕走最短弧 —— 170° → -170° 是 20° 而不是 340°", () => {
    const move = describeCameraMove({ ...base, azimuthDeg: 170 }, { ...base, azimuthDeg: -170 }, 5);
    expect(move.phrase).toContain("环绕20°");
  });

  it("同样的位移，时间越短速度档越高", () => {
    expect(describeCameraMove(base, { ...base, distance: 1.5 }, 12).phrase).toContain("缓慢");
    expect(describeCameraMove(base, { ...base, distance: 1.5 }, 1).phrase).toContain("快速");
  });

  it("变焦与推拉分开写 —— 两者对透视的影响完全不同", () => {
    const move = describeCameraMove(base, { ...base, fov: 20 }, 5);
    expect(move.phrase).toContain("变焦");
    expect(move.phrase).not.toContain("推近");
  });

  it("多个运动叠加时全部写出来", () => {
    const move = describeCameraMove(base, { ...base, distance: 1.5, azimuthDeg: 60, height: 2.4 }, 5);
    expect(move.phrase).toContain("推近");
    expect(move.phrase).toContain("环绕");
    expect(move.phrase).toContain("升高");
  });
});

describe("extractPurpose", () => {
  it("抠得出已有的叙事目的", () => {
    expect(extractPurpose("中景 → 缓慢推近 → 近景，目的：强调角色的迟疑")).toBe("强调角色的迟疑");
  });
  it("半角冒号也认", () => {
    expect(extractPurpose("中景 → 推近 → 近景，目的: 揭示身后的对手")).toBe("揭示身后的对手");
  });
  it("没有目的时返回 null，不编一个", () => {
    expect(extractPurpose("中景 → 缓慢推近 → 近景")).toBeNull();
    expect(extractPurpose(null)).toBeNull();
  });
});

describe("buildCameraDirection", () => {
  const blocking: PrevizBlocking = {
    version: 1,
    camera: rig({ distance: distanceForShotSize("full", 1.7, 40), fov: 40 }),
    placements: PLACEMENTS,
    keyframes: [
      {
        t: 4,
        camera: rig({ distance: distanceForShotSize("closeUp", 1.7, 40), fov: 40 }),
        placements: PLACEMENTS,
      },
    ],
  };

  it("起幅/落幅取自首尾关键帧，格式符合约定 14", () => {
    const out = buildCameraDirection(blocking, SCENE, 4, "旧的，目的：揭示角色的孤立");
    expect(out).toMatch(/^全景.+ → .+推近 → 近景.+，目的：揭示角色的孤立$/);
  });

  it("叙事目的算不出来 —— 没有已有值时留显眼占位，不编造", () => {
    const out = buildCameraDirection(blocking, SCENE, 4, null);
    expect(out).toContain("【待补充");
  });

  it("没有关键帧就是固定镜头，起幅落幅相同", () => {
    const still: PrevizBlocking = { ...blocking, keyframes: [] };
    const out = buildCameraDirection(still, SCENE, 5, "，目的：静观");
    expect(out).toContain("固定镜头");
    const [head, , tail] = out.split(" → ");
    expect(tail.split("，")[0]).toBe(head);
  });
});

describe("buildPrevizWriteback", () => {
  it("两段结果 + 计算依据一起返回", () => {
    const blocking: PrevizBlocking = {
      version: 1,
      camera: rig({ distance: 1.5, height: 1.2, targetHeight: 1.2 }),
      placements: PLACEMENTS,
    };
    const out = buildPrevizWriteback({
      scene: SCENE,
      blocking,
      duration: 5,
      existingStartFrameDesc: "摄影机在旧位置，镜头高度腰部；全景平视，取景全身；角色甲低头；侧光；嘴角下垂——走廊",
      existingCameraDirection: "中景 → 推近 → 近景，目的：强调迟疑",
    });
    expect(out.startFrameDesc.split("；")).toHaveLength(5);
    expect(out.startFrameDesc).toContain("摄影机在角色甲正前方约1.5米");
    expect(out.cameraDirection).toContain("目的：强调迟疑");
    expect(out.notes.some((n) => n.includes("角色甲"))).toBe(true);
    expect(out.notes.some((n) => n.includes("没有关键帧"))).toBe(true);
  });
});
