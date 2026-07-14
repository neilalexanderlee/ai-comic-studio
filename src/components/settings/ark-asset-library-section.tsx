"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, ExternalLink, ShieldCheck } from "lucide-react";

/**
 * 火山方舟「私域虚拟人像素材资产库」凭证配置区块。
 *
 * 用于解决 Seedance 2.0 系列模型拦截真人人脸参考图/视频的问题：把角色定妆图
 * 注册进该私域素材库后，会拿到永久有效的 asset ID，视频生成时改用
 * `asset://<assetId>` 引用角色，不会被人脸审核拦截，且与分镜静图用的同一张脸。
 *
 * 与其他 Provider 使用的 Bearer API Key 不同，这里走 AK/SK 签名鉴权（火山 IAM 访问密钥），
 * 需要在火山引擎控制台 → 访问控制 IAM → 访问密钥 里创建，且账号需要先购买
 * 「Seedance 2.0 高级创作权益包」才能使用私域素材库能力。
 *
 * 凭证存储在专用的 ark_asset_library_credentials 表（见 schema.ts），
 * 与 provider_secrets 表分开，因为需要额外的 projectName / region 字段。
 */

export function ArkAssetLibrarySection() {
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [projectName, setProjectName] = useState("default");
  const [region, setRegion] = useState("cn-beijing");
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasCredentials, setHasCredentials] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const res = await apiFetch("/api/ark-asset-library/credentials");
        const data = (await res.json()) as {
          hasCredentials?: boolean;
          accessKeyId?: string;
          projectName?: string;
          region?: string;
        };
        if (!active) return;
        setAccessKeyId(data.accessKeyId ?? "");
        setProjectName(data.projectName || "default");
        setRegion(data.region || "cn-beijing");
        setHasCredentials(!!data.hasCredentials);
      } catch {
        // ignore
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  async function handleSave() {
    if (!accessKeyId.trim()) {
      toast.error("请输入 Access Key ID");
      return;
    }
    if (!secretAccessKey.trim() && !hasCredentials) {
      toast.error("请输入 Secret Access Key");
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/api/ark-asset-library/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessKeyId: accessKeyId.trim(),
          secretAccessKey: secretAccessKey.trim(),
          projectName: projectName.trim() || "default",
          region: region.trim() || "cn-beijing",
        }),
      });
      setHasCredentials(true);
      setSecretAccessKey("");
      toast.success("私域素材库凭证已保存");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      await apiFetch("/api/ark-asset-library/credentials", { method: "DELETE" });
      setAccessKeyId("");
      setSecretAccessKey("");
      setHasCredentials(false);
      toast.success("私域素材库凭证已清除");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清除失败");
    }
  }

  return (
    <div className="rounded-2xl border border-[--border-subtle] bg-white p-5 space-y-4">
      {/* Section header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[--text-muted]">
            <ShieldCheck className="h-3.5 w-3.5" />
            私域虚拟人像素材资产库 · 真人形象视频解锁
          </h3>
          <p className="mt-1 text-xs text-[--text-muted] max-w-md">
            将角色定妆图注册进火山方舟私域素材库后可绕过 Seedance 2.0 的真人人脸拦截，
            且与分镜静图用同一张脸。需先在控制台购买「Seedance 2.0 高级创作权益包」并创建 IAM 访问密钥。
          </p>
        </div>
        <a
          href="https://console.volcengine.com/iam/keymanage/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 flex items-center gap-1 rounded-lg border border-[--border-subtle] px-2.5 py-1.5 text-xs text-[--text-secondary] transition-colors hover:border-primary hover:text-primary"
        >
          <ExternalLink className="h-3 w-3" />
          访问密钥
        </a>
      </div>

      {/* Access Key ID */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Access Key ID</Label>
          {hasCredentials && (
            <span className="flex items-center gap-1 text-[10px] font-medium text-green-600">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
              已配置
            </span>
          )}
        </div>
        <Input
          type="text"
          value={loading ? "" : accessKeyId}
          onChange={(e) => setAccessKeyId(e.target.value)}
          placeholder={loading ? "加载中…" : "AKLT..."}
          disabled={loading}
          className="font-mono text-xs"
        />
      </div>

      {/* Secret Access Key */}
      <div className="space-y-1.5">
        <Label className="text-xs">Secret Access Key</Label>
        <div className="relative">
          <Input
            type={showSecret ? "text" : "password"}
            value={secretAccessKey}
            onChange={(e) => setSecretAccessKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder={hasCredentials ? "已保存，留空则不修改" : "请输入 Secret Access Key…"}
            disabled={loading}
            className="pr-10 font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => setShowSecret(!showSecret)}
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] hover:text-[--text-primary]"
          >
            {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Project name + region */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">方舟项目名</Label>
          <Input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="default"
            disabled={loading}
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Region</Label>
          <Input
            type="text"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="cn-beijing"
            disabled={loading}
            className="font-mono text-xs"
          />
        </div>
      </div>

      <p className="text-[11px] text-[--text-muted]">
        方舟项目名需与视频生成用的 API Key 所属项目一致，否则注册的素材无法被引用。
        Secret Access Key 只在服务端保存，页面不会回显明文。
      </p>

      {/* Actions */}
      <div className="flex items-center justify-between border-t border-[--border-subtle] pt-3">
        <button
          onClick={handleDelete}
          disabled={loading || !hasCredentials}
          className="text-xs text-[--text-muted] transition-colors hover:text-destructive disabled:opacity-40"
        >
          清除凭证
        </button>
        <Button size="sm" onClick={handleSave} disabled={saving || loading}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          保存
        </Button>
      </div>
    </div>
  );
}
