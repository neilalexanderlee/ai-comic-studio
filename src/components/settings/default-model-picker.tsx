"use client";

import { Label } from "@/components/ui/label";
import { useModelStore, type ModelRef } from "@/stores/model-store";
import { useTranslations } from "next-intl";
import { Type, ImageIcon, VideoIcon, Music } from "lucide-react";

interface PickerRowProps {
  label: string;
  icon: React.ReactNode;
  color: string;
  options: {
    providerId: string;
    providerName: string;
    modelId: string;
    modelName: string;
  }[];
  value: ModelRef | null;
  onChange: (ref: ModelRef | null) => void;
}

function PickerRow({
  label,
  icon,
  color,
  options,
  value,
  onChange,
}: PickerRowProps) {
  const currentValue = value ? `${value.providerId}:${value.modelId}` : "";

  return (
    <div className="flex items-center gap-3 rounded-xl border border-(--border-subtle) bg-(--surface)/50 px-3 py-2.5">
      <div
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${color}`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <Label className="text-[10px] font-semibold uppercase tracking-[0.1em] text-(--text-muted)">
          {label}
        </Label>
        <select
          value={currentValue}
          onChange={(e) => {
            if (!e.target.value) {
              onChange(null);
              return;
            }
            const [providerId, ...rest] = e.target.value.split(":");
            const modelId = rest.join(":");
            onChange({ providerId, modelId });
          }}
          className="mt-0.5 block w-full rounded-lg border-0 bg-transparent py-0 text-sm font-medium text-(--text-primary) outline-none"
        >
          <option value="">--</option>
          {options.map((opt) => (
            <option
              key={`${opt.providerId}:${opt.modelId}`}
              value={`${opt.providerId}:${opt.modelId}`}
            >
              {opt.providerName} / {opt.modelName}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

interface DefaultModelPickerProps {
  /** 平台托管模式（模型由 owner 统一配置）—— 决定「一个模型都没有」时该怎么说 */
  managed?: boolean;
}

export function DefaultModelPicker({ managed = false }: DefaultModelPickerProps) {
  const t = useTranslations("settings");
  const {
    providers,
    defaultTextModel,
    defaultImageModel,
    defaultVideoModel,
    defaultMusicModel,
    setDefaultTextModel,
    setDefaultImageModel,
    setDefaultVideoModel,
    setDefaultMusicModel,
  } = useModelStore();

  function getOptions(capability: string) {
    const result: {
      providerId: string;
      providerName: string;
      modelId: string;
      modelName: string;
    }[] = [];
    for (const p of providers) {
      if (p.capability !== capability) continue;
      for (const m of p.models) {
        if (!m.checked) continue;
        result.push({
          providerId: p.id,
          providerName: p.name,
          modelId: m.id,
          modelName: m.name,
        });
      }
    }
    return result;
  }

  // 一个可选模型都没有时，四个空下拉框什么也没说明 ——
  // 用户看到的是「--」，分不清是没配、没拉到、还是自己权限不够。
  // 平台模式下这是「去找管理员」，自部署下是「自己往下配」，引导完全相反。
  const hasAnyOption =
    getOptions("text").length +
      getOptions("image").length +
      getOptions("video").length +
      getOptions("music").length >
    0;

  if (!hasAnyOption) {
    return (
      <div className="rounded-xl border border-dashed border-(--border-subtle) bg-(--surface)/50 px-4 py-5 text-sm text-(--text-muted)">
        {managed ? (
          <>
            平台还没有配置任何可用模型，请联系管理员。
            <span className="block text-xs">
              （模型由平台统一配置，你这边不需要、也无法填写 API Key）
            </span>
          </>
        ) : (
          <>
            还没有可用的模型。
            <span className="block text-xs">
              在下方按能力分类添加模型服务商，并勾选要启用的模型后，这里就能选默认模型了。
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <PickerRow
        label={t("defaultTextModel")}
        icon={<Type className="h-4 w-4" />}
        color="bg-blue-500/10 text-blue-600"
        options={getOptions("text")}
        value={defaultTextModel}
        onChange={setDefaultTextModel}
      />
      <PickerRow
        label={t("defaultImageModel")}
        icon={<ImageIcon className="h-4 w-4" />}
        color="bg-emerald-500/10 text-emerald-600"
        options={getOptions("image")}
        value={defaultImageModel}
        onChange={setDefaultImageModel}
      />
      <PickerRow
        label={t("defaultVideoModel")}
        icon={<VideoIcon className="h-4 w-4" />}
        color="bg-purple-500/10 text-purple-600"
        options={getOptions("video")}
        value={defaultVideoModel}
        onChange={setDefaultVideoModel}
      />
      <PickerRow
        label="默认音乐模型"
        icon={<Music className="h-4 w-4" />}
        color="bg-pink-500/10 text-pink-600"
        options={getOptions("music")}
        value={defaultMusicModel}
        onChange={setDefaultMusicModel}
      />
    </div>
  );
}
