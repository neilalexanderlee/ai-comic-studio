/**
 * ark-asset-library.ts
 *
 * 火山方舟「私域虚拟人像素材资产库」客户端。
 * 官方文档：https://www.volcengine.com/docs/82379/2333565
 *
 * 解决的问题：Seedance 2.0 系列模型不支持直接上传含真人人脸的参考图/视频（防深伪拦截）。
 * 把角色定妆图注册进私域素材库后，会拿到一个永久有效的 asset ID（`asset-xxxxx`），
 * 视频生成时改用 `asset://<asset ID>` 引用该角色，不会被人脸审核拦截。
 *
 * 认证方式：AK/SK 签名（管控面 API），与文本/图片/视频生成用的 Bearer API Key 是两套凭证。
 * 复用项目里已经在用的 @volcengine/openapi 通用签名客户端（参见 providers/jimeng-image.ts）。
 *
 * ⚠️ host / region 目前按火山官方通用 OpenAPI 网关填写的最佳猜测值，本项目未接入真实 AK/SK
 * 测试过，如调用报「服务不存在」类错误，请对照火山方舟 API Explorer 或 Go/Python SDK 示例
 * （文档里 `universal.New(sess).DoCall(...)` 那段）核对实际 host，必要时通过 params.host 覆盖。
 */
// @ts-ignore — @volcengine/openapi 无官方类型声明
import { Service } from "@volcengine/openapi";

export interface ArkAssetLibraryCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** 素材组/素材所属的方舟项目名，默认 default；需与调用视频生成 API 的 Key 所属项目一致 */
  projectName?: string;
  region?: string;
  /** 管控面 API 网关地址，默认 open.volcengineapi.com（未经真实账号验证，可能需要按实际情况调整） */
  host?: string;
}

export type ArkAssetType = "Image" | "Video" | "Audio";
export type ArkAssetStatus = "Processing" | "Active" | "Failed";

interface ArkApiError {
  Code?: string;
  Message?: string;
  CodeN?: number;
}

interface ArkApiResponse<T> {
  ResponseMetadata?: { Error?: ArkApiError; RequestId?: string };
  Result?: T;
}

function assertNoError(response: ArkApiResponse<unknown>, action: string) {
  const err = response?.ResponseMetadata?.Error;
  if (err) {
    throw new Error(`[ArkAssetLibrary] ${action} failed: ${err.Message ?? err.Code ?? "unknown error"}`);
  }
}

/**
 * 创建调用私域素材库管控面 API 的客户端。
 * 每个 action 对应一次 svc.createJSONAPI(...) 调用（与 jimeng-image.ts 的用法一致）。
 */
export function createArkAssetLibraryClient(credentials: ArkAssetLibraryCredentials) {
  const region = credentials.region || "cn-beijing";
  const host = (credentials.host || "open.volcengineapi.com").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const projectName = credentials.projectName || "default";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new (Service as any)({
    service: "ark",
    version: "2024-01-01",
    host,
    region,
  });
  svc.setAccessKeyId(credentials.accessKeyId);
  svc.setSecretKey(credentials.secretAccessKey);

  const callCreateAssetGroup = svc.createJSONAPI("CreateAssetGroup", { Version: "2024-01-01" });
  const callCreateAsset = svc.createJSONAPI("CreateAsset", { Version: "2024-01-01" });
  const callGetAsset = svc.createJSONAPI("GetAsset", { Version: "2024-01-01" });
  const callListAssets = svc.createJSONAPI("ListAssets", { Version: "2024-01-01" });

  return {
    /** 创建素材组合（一个角色对应一个组），返回 groupId（如 "group-20260318033332-xxxxx"） */
    async createAssetGroup(name: string, description?: string): Promise<string> {
      const response = (await callCreateAssetGroup({
        Name: name,
        Description: description ?? "",
        GroupType: "AIGC",
        ProjectName: projectName,
      })) as ArkApiResponse<{ Id: string }>;
      assertNoError(response, "CreateAssetGroup");
      const id = response.Result?.Id;
      if (!id) throw new Error("[ArkAssetLibrary] CreateAssetGroup: 响应中没有 Id");
      return id;
    },

    /**
     * 上传素材（图片/视频/音频的公网可访问 URL）。
     * 注意：url 必须是火山服务端可直接抓取的公网地址；本地/内网地址会导致入库失败。
     * 返回 assetId（如 "asset-20260318071009-xxxxx"），此时状态通常还是 Processing，需轮询 getAsset。
     */
    async createAsset(groupId: string, url: string, assetType: ArkAssetType = "Image", label?: string): Promise<string> {
      const response = (await callCreateAsset({
        GroupId: groupId,
        URL: url,
        AssetType: assetType,
        Name: label ?? "",
        ProjectName: projectName,
      })) as ArkApiResponse<{ Id: string }>;
      assertNoError(response, "CreateAsset");
      const id = response.Result?.Id;
      if (!id) throw new Error("[ArkAssetLibrary] CreateAsset: 响应中没有 Id");
      return id;
    },

    /** 查询单个素材状态：Processing（处理中）/ Active（可用）/ Failed（失败需重传） */
    async getAsset(assetId: string): Promise<{ status: ArkAssetStatus; url?: string }> {
      const response = (await callGetAsset({
        Id: assetId,
        ProjectName: projectName,
      })) as ArkApiResponse<{ Status: ArkAssetStatus; URL?: string }>;
      assertNoError(response, "GetAsset");
      const result = response.Result;
      if (!result?.Status) throw new Error("[ArkAssetLibrary] GetAsset: 响应中没有 Status");
      return { status: result.Status, url: result.URL };
    },

    /** 按组合 ID 列出素材（可选，管理/排查用） */
    async listAssets(groupId: string) {
      const response = (await callListAssets({
        Filter: { GroupIds: [groupId] },
        PageNumber: 1,
        PageSize: 100,
      })) as ArkApiResponse<{ Items: Array<{ Id: string; Status: ArkAssetStatus }> }>;
      assertNoError(response, "ListAssets");
      return response.Result?.Items ?? [];
    },
  };
}

/**
 * 轮询素材状态直到 Active / Failed / 超时。
 * 官方建议：单图处理约 13 秒，无 SLA 承诺；这里默认每 3 秒查一次，90 秒超时（与官方文档建议一致）。
 */
export async function pollArkAssetUntilReady(
  client: ReturnType<typeof createArkAssetLibraryClient>,
  assetId: string,
  opts?: { intervalMs?: number; timeoutMs?: number }
): Promise<{ status: ArkAssetStatus; url?: string }> {
  const intervalMs = opts?.intervalMs ?? 3000;
  const timeoutMs = opts?.timeoutMs ?? 90000;
  const startedAt = Date.now();

  while (true) {
    const { status, url } = await client.getAsset(assetId);
    if (status === "Active" || status === "Failed") return { status, url };
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`[ArkAssetLibrary] 素材 ${assetId} 轮询超时（>${Math.round(timeoutMs / 1000)}s），当前状态：${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * 高层封装：把一张角色定妆图注册进私域素材库。
 * - 若 existingGroupId 为空，先创建一个以角色名命名的素材组合
 * - 上传素材（imageUrl 必须是公网可访问地址），轮询到 Active/Failed
 * - 返回 groupId + assetId + 最终状态，调用方负责写回 DB
 */
export async function registerCharacterPortraitToArk(params: {
  credentials: ArkAssetLibraryCredentials;
  characterName: string;
  existingGroupId?: string | null;
  imageUrl: string;
  label?: string;
}): Promise<{ groupId: string; assetId: string; status: ArkAssetStatus }> {
  const client = createArkAssetLibraryClient(params.credentials);

  const groupId = params.existingGroupId || (await client.createAssetGroup(params.characterName));
  const assetId = await client.createAsset(groupId, params.imageUrl, "Image", params.label);
  const { status } = await pollArkAssetUntilReady(client, assetId);

  return { groupId, assetId, status };
}
