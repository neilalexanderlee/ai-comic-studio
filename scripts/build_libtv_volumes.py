#!/usr/bin/env python3
import argparse
import math
import re
from dataclasses import dataclass
from pathlib import Path


EP_RE = re.compile(r"^## 第\s*(\d+)\s*集[:：](.+?)\s*$", re.M)
TIME_RE = re.compile(r"^\*\*(\d+):(\d{2})-(\d+):(\d{2})\|(.+?)\*\*.*$", re.M)


VOLUMES = [
    ("第一卷", "灰烬", range(1, 6), "伤痛与羁绊，仇恨生根，勇者小队成形"),
    ("第二卷", "试炼", range(6, 11), "四人组队，遭遇将军压迫，寻找破局之剑"),
    ("第三卷", "清醒者", range(11, 16), "圣剑入手，白夜与萝拉线展开，魔王阴谋浮出"),
    ("第四卷", "流亡", range(16, 21), "萝拉背叛魔王，六人首次并肩，走向永冬城"),
    ("第五卷", "讨伐", range(21, 26), "放下仇恨，分路讨伐七将军，终局战前集结"),
    ("第六卷", "终战", range(26, 31), "击败余下将军，汇合永冬城，终战与尾声"),
]

TARGET_DURATIONS = {
    17: 180,
    20: 165,
    22: 165,
    23: 165,
    24: 180,
    27: 165,
    28: 210,
    29: 210,
    30: 120,
}

DEFAULT_TARGET_SECONDS = 150
MAX_BEAT_SECONDS = 15


@dataclass
class TimedBlock:
    start: int
    end: int
    title: str
    body: str


@dataclass
class Episode:
    number: int
    title: str
    raw: str
    summary: str
    setting: str
    blocks: list[TimedBlock]
    image_list: str


WEAPON_RULES = [
    "龙渊第01-10集使用背负式双手大剑「无名剑」；第11集起使用背负式双手大剑「无双」。",
    "龙渊的剑始终背在背上，战斗时从背后拔出；禁止写成腰佩、腰挂、单手长剑或细佩剑。",
    "无双是金色宽刃双手大剑，刃纹如龙鳞；无名剑是普通宽刃双手大剑。",
    "白夜使用腰间野太刀「霜魂」，总长约150cm，出鞘后双手持握；格朗双手握巨斧「裂地」。",
]


def normalize_prompt_text(text: str) -> str:
    replacements = [
        ("普通佩剑「无名剑」", "背负式双手大剑「无名剑」"),
        ("拿着背负式双手大剑", "背着双手大剑"),
        ("普通佩剑第 11 集替换为无双", "背负式双手大剑第 11 集替换为无双"),
        ("**无名剑**:龙渊原本的普通佩剑第 11 集替换为无双", "**无名剑**:龙渊原本的背负式双手大剑，第 11 集替换为无双"),
        ("**无双**:矮人圣剑矮人先祖留下的神器第 11 集龙渊通过试炼获得", "**无双**:矮人圣剑，宽刃金色双手大剑，龙渊第 11 集通过试炼获得，平时背在背上"),
        ("腰间挂着长剑", "背后斜背双手大剑"),
        ("腰佩「无名剑」", "背负双手大剑「无名剑」"),
        ("龙渊手持无双", "龙渊双手握持无双"),
        ("背后持矮人圣剑「无双」", "背后斜背矮人圣剑「无双」"),
        ("手握六色光芒共鸣的长剑", "双手握六色光芒共鸣的宽刃大剑"),
        ("单手持发光长剑", "右手单握发光的宽刃双手大剑"),
        ("无双剑收于腰侧", "无双剑收至身体右侧蓄势"),
        ("手按剑柄", "反手按住背后剑柄"),
        ("龙渊拔出无名剑", "龙渊从背后拔出无名剑"),
        ("龙渊拔出无双剑", "龙渊从背后拔出无双剑"),
        ("龙渊(拔出无名剑", "龙渊(从背后拔出无名剑"),
        ("龙渊(拔出无双剑", "龙渊(从背后拔出无双剑"),
        ("龙渊拔剑", "龙渊从背后拔剑"),
        ("龙渊(拔剑", "龙渊(从背后拔剑"),
        ("龙渊（拔剑", "龙渊（从背后拔剑"),
        ("龙渊从背后拔剑立于大殿中央", "龙渊双手持剑立于大殿中央"),
        ("龙渊无名剑", "龙渊双手大剑「无名剑」"),
        ("龙渊无双剑", "龙渊双手大剑「无双」"),
        ("龙渊的手在地面慢慢摸索——摸到了无双剑的剑柄", "龙渊的手在地面慢慢摸索——摸到了背负式双手大剑「无双」的剑柄"),
    ]
    for old, new in replacements:
        text = text.replace(old, new)
    return text


def weapon_rules_for_episode(ep_number: int) -> list[str]:
    current = "无名剑" if ep_number <= 10 else "无双"
    if ep_number == 11:
        current = "前半段无名剑，获得圣剑后无双"
    return [f"本集龙渊武器: {current}。", *WEAPON_RULES]


def parse_time(minute: str, second: str) -> int:
    return int(minute) * 60 + int(second)


def fmt_time(seconds: int) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}"


def get_section(text: str, name: str) -> str:
    pattern = re.compile(
        rf"\*\*【{re.escape(name)}】\*\*\s*\n(?P<body>.*?)(?=\n---\n|\n\*\*【|\Z)",
        re.S,
    )
    match = pattern.search(text)
    if not match:
        return ""
    return match.group("body").strip()


def compact_text(text: str, max_chars: int = 360) -> str:
    text = re.sub(r"\n{3,}", "\n\n", text.strip())
    text = re.sub(r"[ \t]+", " ", text)
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "..."


def extract_image_list(text: str) -> str:
    marker = "**【本集重点画面清单】**"
    if marker not in text:
        return ""
    tail = text.split(marker, 1)[1]
    tail = re.split(r"\n---\n|^## 第\s*\d+\s*集", tail, maxsplit=1, flags=re.M)[0]
    return tail.strip()


def parse_blocks(text: str) -> list[TimedBlock]:
    matches = list(TIME_RE.finditer(text))
    blocks = []
    for index, match in enumerate(matches):
        start = parse_time(match.group(1), match.group(2))
        end = parse_time(match.group(3), match.group(4))
        title = match.group(5).strip()
        body_start = match.end()
        body_end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = text[body_start:body_end]
        body = re.split(r"\n\*\*【打戏分镜表】|\n\*\*【本集重点画面清单】", body, maxsplit=1)[0]
        blocks.append(TimedBlock(start, end, title, body.strip()))
    return blocks


def parse_episodes(source: str) -> list[Episode]:
    matches = list(EP_RE.finditer(source))
    episodes = []
    for index, match in enumerate(matches):
        number = int(match.group(1))
        title = match.group(2).strip()
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(source)
        raw = source[start:end]
        if number == 30:
            raw = raw.split("\n# 伏笔回收总表", 1)[0]
        episodes.append(
            Episode(
                number=number,
                title=title,
                raw=raw.strip(),
                summary=get_section(raw, "剧情概要"),
                setting=get_section(raw, "场景设定"),
                blocks=parse_blocks(raw),
                image_list=extract_image_list(raw),
            )
        )
    return episodes


def target_duration(ep: Episode) -> int:
    return TARGET_DURATIONS.get(ep.number, DEFAULT_TARGET_SECONDS)


def distribute_durations(blocks: list[TimedBlock], target: int) -> list[int]:
    if not blocks:
        return []
    original = [max(1, block.end - block.start) for block in blocks]
    total = sum(original)
    scaled = [max(8, round(item * target / total)) for item in original]
    diff = target - sum(scaled)
    order = sorted(range(len(scaled)), key=lambda idx: original[idx], reverse=True)
    while diff != 0:
        changed = False
        for idx in order:
            if diff > 0:
                scaled[idx] += 1
                diff -= 1
                changed = True
            elif scaled[idx] > 8:
                scaled[idx] -= 1
                diff += 1
                changed = True
            if diff == 0:
                break
        if not changed:
            break
    return scaled


def split_block(block: TimedBlock, duration: int) -> list[tuple[int, str]]:
    count = max(1, math.ceil(duration / MAX_BEAT_SECONDS))
    base = duration // count
    rem = duration % count
    parts = []
    for idx in range(count):
        seconds = base + (1 if idx < rem else 0)
        if count == 1:
            title = block.title
        else:
            title = f"{block.title}·节拍{idx + 1:02d}"
        parts.append((seconds, title))
    return parts


def clean_cue(text: str) -> str:
    text = re.sub(r"\*\*|\*|【|】|`", "", text)
    text = re.sub(r"startFrame|endFrame|videoScript", "", text)
    text = re.sub(r"^\s*[-①②③④⑤⑥\d.、]+\s*", "", text)
    text = re.sub(r"^(镜头|画面|台词|对话|音效|字幕|特效|打戏分镜)[:：]?", "", text)
    text = re.sub(r"\s+", " ", text).strip(" ：:；;-")
    return text


def unique_items(items: list[str], max_chars: int = 180) -> list[str]:
    output = []
    seen = set()
    for item in items:
        item = normalize_prompt_text(clean_cue(item))
        if not item or item in seen:
            continue
        seen.add(item)
        output.append(compact_text(item, max_chars) if len(item) > max_chars else item)
    return output


def field_lines(block: TimedBlock, field: str) -> list[str]:
    pattern = re.compile(rf"(?:-\s*)?\*\*【{field}】\*\*\s*(.*?)(?=\n\s*-\s*\*\*【|\n\s*\*\*【|\Z)", re.S)
    items = []
    for match in pattern.finditer(block.body):
        chunk = match.group(1).strip()
        chunk = re.split(r"\n\s*-\s*\*\*【|\n\s*\*\*【", chunk, maxsplit=1)[0]
        chunk = re.split(r"\n\s*-\s*\*\*(?:startFrame|endFrame|videoScript)\*\*|\n\s*-\s*\*\*startFrame\*\*|\n\s*-\s*\*\*endFrame\*\*|\n\s*-\s*\*\*videoScript\*\*", chunk, maxsplit=1)[0]
        for line in chunk.splitlines():
            line = line.strip()
            if line:
                items.append(line)
    return unique_items(items, 160)


def dialogue_lines(block: TimedBlock) -> list[str]:
    items = []
    for field in ("台词", "对话"):
        items.extend(field_lines(block, field))

    # Dialogue often appears on nested list lines after a dialogue marker.
    for line in block.body.splitlines():
        stripped = line.strip()
        if "「" in stripped and "」" in stripped and "字幕" not in stripped:
            stripped = re.sub(r"^\s*[-①②③④⑤⑥\d.、]+\s*", "", stripped)
            items.append(stripped)
    return unique_items(items, 180)


def sound_lines(block: TimedBlock) -> list[str]:
    items = []
    items.extend(field_lines(block, "音效"))
    visual_markers = ("镜头", "画面", "startFrame", "endFrame", "videoScript", "中景", "特写", "远景", "近景", "全景", "慢镜头", "快切", "导演注")
    for line in block.body.splitlines():
        stripped = line.strip()
        if any(marker in stripped for marker in visual_markers):
            continue
        if any(word in stripped for word in ("声", "轰", "啪", "咔", "嗡", "风", "火焰", "爆鸣", "脚步", "呼吸", "惨叫", "音乐", "配乐")):
            if "「" not in stripped:
                items.append(stripped)
    return unique_items(items, 160)


def subtitle_lines(block: TimedBlock) -> list[str]:
    return field_lines(block, "字幕")


def visual_lines(block: TimedBlock) -> list[str]:
    items = []
    for field in ("画面", "特效"):
        items.extend(field_lines(block, field))
    for line in block.body.splitlines():
        stripped = line.strip()
        if any(word in stripped for word in ("全景", "中景", "特写", "远景", "近景", "慢镜头", "快切", "画面", "光", "火", "雪", "雾", "城", "宫殿", "山谷")):
            if "「" not in stripped:
                items.append(stripped)
    return unique_items(items, 190)


def action_lines(block: TimedBlock) -> list[str]:
    raw_lines = []
    for line in block.body.splitlines():
        line = clean_cue(line)
        if len(line) >= 6 and "「" not in line:
            raw_lines.append(line)

    joined = clean_cue(block.body)
    split_points = re.split(r"[。；;]|(?<=」)", joined)
    for item in split_points:
        item = clean_cue(item)
        if len(item) >= 8 and "「" not in item:
            raw_lines.append(item)

    return unique_items(raw_lines, 180) or [f"承接“{block.title}”，保持角色、场景与情绪连续，镜头给出明确动作结果。"]


def pick(items: list[str], index: int, fallback: str) -> str:
    if not items:
        return fallback
    return items[index % len(items)]


def beat_payload(block: TimedBlock, part_index: int) -> dict[str, str]:
    actions = action_lines(block)
    visuals = visual_lines(block)
    dialogues = dialogue_lines(block)
    sounds = sound_lines(block)
    subtitles = subtitle_lines(block)

    title_lower = block.title
    default_sound = "环境底噪延续，动作点给出轻微 Foley；无对白时保留呼吸、脚步或风声。"
    if any(word in title_lower for word in ("战", "攻击", "魔兽", "火龙", "魔龙", "打败", "压制", "冲")):
        default_sound = "武器破风、脚步急停、撞击声和短促呼吸；命中点加强金属或能量爆响。"
    elif any(word in title_lower for word in ("夜", "篝火", "雪", "山林", "城", "宫殿")):
        default_sound = "环境声为主：风声、火焰或空间回响，音乐低铺，不抢对白。"

    return {
        "shot": pick(actions, part_index, f"承接“{block.title}”，镜头给出明确动作结果。"),
        "visual": pick(visuals, part_index, "保持角色定妆一致，突出本节拍的动作结果和情绪变化。"),
        "dialogue": pick(dialogues, part_index, "无"),
        "sound": pick(sounds, part_index, default_sound),
        "subtitle": pick(subtitles, part_index, "无"),
    }


def render_episode(ep: Episode) -> str:
    total = target_duration(ep)
    durations = distribute_durations(ep.blocks, total)
    lines = [
        f"# 第{ep.number:02d}集 {ep.title}",
        "",
        f"时长: {fmt_time(total)}",
        "格式: LibTV分集脚本 / 秒级节拍 / 每个节拍不超过15秒",
        "节奏: 删除重复停顿，战斗以快切、命中、反应、转折推进，降低无效镜头成本",
        "",
        "## 剧情概要",
        compact_text(ep.summary, 500) if ep.summary else "本集按主线推进。",
        "",
        "## 场景设定",
        compact_text(ep.setting, 420) if ep.setting else "沿用本卷世界观与角色设定。",
        "",
        "## 角色武器一致性",
        *[f"- {rule}" for rule in weapon_rules_for_episode(ep.number)],
        "",
        "## 分镜详情",
    ]
    cursor = 0
    for block, duration in zip(ep.blocks, durations):
        for part_index, (seconds, title) in enumerate(split_block(block, duration)):
            payload = beat_payload(block, part_index)
            start = cursor
            end = cursor + seconds
            lines.extend(
                [
                    "",
                    f"### {fmt_time(start)}-{fmt_time(end)} | {title}",
                    f"- 镜头: {payload['shot']}",
                    f"- 画面: {payload['visual']}",
                    f"- 对白: {payload['dialogue']}",
                    f"- 音效: {payload['sound']}",
                    f"- 字幕: {payload['subtitle']}",
                ]
            )
            cursor = end
    if ep.image_list:
        lines.extend(["", "## 本集重点画面清单", compact_text(normalize_prompt_text(ep.image_list), 900)])
    return "\n".join(lines).strip() + "\n"


def render_volume(name: str, subtitle: str, ep_range: range, theme: str, episodes: dict[int, Episode]) -> str:
    selected = [episodes[num] for num in ep_range if num in episodes]
    lines = [
        f"# 大剑勇者_{name}_{subtitle}_LibTV分卷版",
        "",
        f"卷范围: 第{selected[0].number:02d}集-第{selected[-1].number:02d}集",
        f"核心主题: {theme}",
        "上传建议: 本文件可作为一个 LibTV 剧本节点；若生成压力较大，优先按每个 `# 第XX集` 单独复制生成。",
        "解析规则: 顶级标题只用于卷名和每集标题；每集均有明确时长、剧情概要、场景设定、秒级分镜。",
        "全卷武器规则: 龙渊的剑始终是背负式双手大剑；第01-10集为无名剑，第11集起为无双，禁止生成腰佩长剑。",
        "",
        "---",
        "",
    ]
    for idx, ep in enumerate(selected):
        if idx:
            lines.extend(["", "---", ""])
        lines.append(render_episode(ep).strip())
    return "\n".join(lines).strip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--outdir", required=True)
    args = parser.parse_args()

    source_path = Path(args.source)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    text = normalize_prompt_text(source_path.read_text(encoding="utf-8"))
    episodes = {ep.number: ep for ep in parse_episodes(text)}

    stats = []
    for ep in episodes.values():
        original_end = max((block.end for block in ep.blocks), default=0)
        over_60 = [block for block in ep.blocks if block.end - block.start > 60]
        stats.append((ep.number, original_end, target_duration(ep), len(over_60)))

    for name, subtitle, ep_range, theme in VOLUMES:
        content = render_volume(name, subtitle, ep_range, theme, episodes)
        filename = f"大剑勇者_{name}_{subtitle}_LibTV分卷版.md"
        (outdir / filename).write_text(content, encoding="utf-8")

    report = outdir / "README_生成说明.md"
    report.write_text(
        "\n".join(
            [
                "# 大剑勇者 LibTV 分卷版生成说明",
                "",
                "处理内容:",
                "- 修复龙渊武器一致性: 所有分卷均明确龙渊使用背负式双手大剑，禁止腰佩长剑；第01-10集为无名剑，第11集起为无双。",
                "- 进一步压缩总时长: 常规集压缩为 2:30；重点战斗集为 2:45-3:30；尾声压缩为 2:00。",
                "- 所有分镜节拍均拆为不超过 15 秒，长战斗段和终战段已细分。",
                "- 最细版字段: 每个节拍拆出 `镜头 / 画面 / 对白 / 音效 / 字幕`，对白与环境声优先从原稿真实内容抽取。",
                "- 输出为 6 个分卷文件，每卷 5 集，使用 `# 第XX集` 作为硬分集边界。",
                "- 保留原主线剧情、关键角色关系、转折和终战信息；删减重复停顿、重复解释和拖时长镜头。",
                "- 删除原稿前后大量设定/提示词干扰，只保留 LibTV 更容易识别的分集正文。",
                "",
                "原稿时长压缩统计:",
                "| 集数 | 原稿约时长 | 新版时长 | 原稿超过60秒段落数 |",
                "|------|------------|----------|--------------------|",
                *[
                    f"| 第{num:02d}集 | {fmt_time(orig)} | {fmt_time(new)} | {over} |"
                    for num, orig, new, over in stats
                ],
                "",
                "使用建议:",
                "- 最稳: 每次复制一个 `# 第XX集` 到 LibTV 单独生成。",
                "- 折中: 每次上传一个分卷文件。",
                "- 不建议: 重新上传包含世界观、角色表、伏笔表、提示词的完整长文档。",
                "",
            ]
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
