// 本地后端 API 客户端。
// 组件层只依赖这些导出，底层的 Supabase SDK 已被同源 /api/* 取代。

const apiFetch = async (path, options = {}) => {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const body = await response.json();
      message = body?.error || message;
    } catch {
      // 非 JSON 响应时保留默认信息
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
};

// 当前项目始终内置后端，保留该导出以兼容原有条件渲染逻辑。
export const backendConfigured = true;

export const defaultRecommendationSortSettings = {
  distance_weight: 50,
  response_weight: 50,
};

export const api = { fetch: apiFetch };

// crypto.randomUUID 只在安全上下文（https / localhost）可用，
// 非安全上下文（http://host:port）不支持 crypto.randomUUID，这里保留一个 getRandomValues 兜底实现。
export function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const reactionVoterStorageKey = "place-reaction-voter-token";
const requirePlaceId = (id) => {
  if (typeof id !== "string" || !id.trim())
    throw new Error("地点 ID 无效，请刷新后台后重试");
  return id;
};

function getReactionVoterToken() {
  let token = window.localStorage.getItem(reactionVoterStorageKey);
  if (!token) {
    token = randomId();
    window.localStorage.setItem(reactionVoterStorageKey, token);
  }
  return token;
}

// --------------------------------------------------------------- 图片处理
export async function compressImageToWebp(file, maxDimension = 1600, quality = 0.82) {
  if (
    !file?.type?.startsWith("image/") ||
    file.type === "image/gif" ||
    typeof createImageBitmap !== "function"
  )
    return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    bitmap.close();
    if (!blob || blob.size >= file.size) return file;
    const basename = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${basename}.webp`, {
      type: "image/webp",
      lastModified: Date.now(),
    });
  } catch {
    bitmap?.close?.();
    return file;
  }
}

async function imageFormData(payload, files) {
  const formData = new FormData();
  formData.set("payload", JSON.stringify(payload));
  for (const sourceFile of files) {
    const file = await compressImageToWebp(sourceFile);
    formData.append("images", file, file.name);
  }
  return formData;
}

// --------------------------------------------------------------- 公共数据
export async function loadDynamicCatalog() {
  const catalog = await apiFetch("/api/catalog");
  return {
    categories: catalog.categories,
    detailFields: catalog.detailFields,
    places: catalog.places,
    reactions: catalog.reactions,
    reactionSummaries: catalog.reactionSummaries || [],
    sortSettings: catalog.sortSettings || defaultRecommendationSortSettings,
  };
}

export function mapDynamicPlace(row, categoriesById, detailFields) {
  const category = categoriesById[row.category_id];
  const details = detailFields.map((field) => ({
    key: field.key,
    label: field.label,
    value:
      row[field.key] ||
      row[field.key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] ||
      row.custom_details?.[field.key] ||
      field.default_value ||
      "",
  }));
  const images = row.image_urls?.length
    ? row.image_urls
    : row.cover_url
      ? [row.cover_url]
      : [];
  return {
    id: row.id,
    name: row.name,
    recommendation: row.recommendation,
    category: row.category_id,
    categoryLabel: category?.label || row.category_id || "",
    color: category?.color,
    coordinates: [row.longitude, row.latitude],
    address: row.address || "",
    rating: row.rating ?? "—",
    cover: row.cover_url || images[0] || "",
    images,
    tags: row.tags || [],
    highlights: row.highlights || [],
    details,
  };
}

// --------------------------------------------------------------- 投稿
export async function submitPlace(payload, _turnstileToken, files = []) {
  let fingerprint = localStorage.getItem("submission-fingerprint");
  if (!fingerprint) {
    fingerprint = randomId();
    localStorage.setItem("submission-fingerprint", fingerprint);
  }
  const formData = await imageFormData(payload, files);
  formData.set("fingerprint", fingerprint);
  const data = await apiFetch("/api/submissions", { method: "POST", body: formData });
  return data.queryCode;
}

export async function submitPlaceWithImages(payload, files = [], turnstileToken) {
  return submitPlace(payload, turnstileToken, files);
}

export async function getSubmissionStatus(queryCode) {
  const code = String(queryCode || "").trim();
  if (!code) return null;
  try {
    return await apiFetch(`/api/submissions/${encodeURIComponent(code)}`);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

// --------------------------------------------------------------- 表情响应
export async function loadPlaceReactions(placeId) {
  const token = getReactionVoterToken();
  return apiFetch(`/api/places/${encodeURIComponent(placeId)}/reactions?voterToken=${encodeURIComponent(token)}`);
}

export async function setPlaceReaction(placeId, reaction) {
  return apiFetch(`/api/places/${encodeURIComponent(placeId)}/reactions`, {
    method: "POST",
    body: JSON.stringify({ reaction, voterToken: getReactionVoterToken() }),
  });
}

// --------------------------------------------------------------- 管理后台
export async function signInAdmin(username, password) {
  const data = await apiFetch("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return data.admin;
}

export async function restoreAdminSession() {
  try {
    const data = await apiFetch("/api/admin/session");
    return data.admin;
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }
}

export async function signOutAdmin() {
  await apiFetch("/api/admin/logout", { method: "POST" });
}

export async function loadPendingPlaces() {
  return apiFetch("/api/admin/places?status=pending");
}

export async function loadPlacesByStatus(status) {
  return apiFetch(`/api/admin/places?status=${encodeURIComponent(status)}`);
}

export async function updatePlace(id, changes) {
  return apiFetch(`/api/admin/places/${encodeURIComponent(requirePlaceId(id))}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export async function deletePlace(id) {
  await apiFetch(`/api/admin/places/${encodeURIComponent(requirePlaceId(id))}`, {
    method: "DELETE",
  });
}

export async function loadAdminCatalog() {
  const catalog = await apiFetch("/api/admin/catalog");
  return {
    categories: catalog.categories || [],
    fields: catalog.fields || [],
    reactions: catalog.reactions || [],
    sortSettings: catalog.sortSettings || defaultRecommendationSortSettings,
  };
}

export async function saveRecommendationSortSettings(distanceWeight) {
  const distance = Number(distanceWeight);
  if (!Number.isInteger(distance) || distance < 0 || distance > 100)
    throw new Error("距离权重必须是 0 到 100 的整数");
  return apiFetch("/api/admin/sort-settings", {
    method: "POST",
    body: JSON.stringify({ distanceWeight: distance }),
  });
}

export async function loadPlaceReactionOptions(placeIds = []) {
  if (!placeIds.length) return [];
  return apiFetch("/api/admin/reaction-options", {
    method: "POST",
    body: JSON.stringify({ placeIds }),
  });
}

export async function loadPlaceReactionSummaries(placeIds = []) {
  if (!placeIds.length) return [];
  return apiFetch("/api/admin/reaction-summaries", {
    method: "POST",
    body: JSON.stringify({ placeIds }),
  });
}

export async function saveReactionDefinition(reaction) {
  return apiFetch("/api/admin/reactions", {
    method: "POST",
    body: JSON.stringify(reaction),
  });
}

export async function deleteReactionDefinition(value) {
  await apiFetch(`/api/admin/reactions/${encodeURIComponent(value)}`, { method: "DELETE" });
}

export async function savePlaceReactionOption(placeId, reactionValue, isEnabled) {
  return apiFetch(`/api/admin/places/${encodeURIComponent(placeId)}/reaction-option`, {
    method: "POST",
    body: JSON.stringify({ reactionValue, isEnabled }),
  });
}

export async function savePlaceReactionCount(placeId, reactionValue, count) {
  await apiFetch(`/api/admin/places/${encodeURIComponent(placeId)}/reaction-count`, {
    method: "POST",
    body: JSON.stringify({ reactionValue, count }),
  });
}

export async function saveCategory(category) {
  return apiFetch("/api/admin/categories", {
    method: "POST",
    body: JSON.stringify(category),
  });
}

export async function saveDetailField(field) {
  return apiFetch("/api/admin/fields", {
    method: "POST",
    body: JSON.stringify(field),
  });
}

export async function deleteCategory(id) {
  await apiFetch(`/api/admin/categories/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function deleteDetailField(key) {
  await apiFetch(`/api/admin/fields/${encodeURIComponent(key)}`, { method: "DELETE" });
}

export async function createApprovedPlaceWithImages(payload, files = []) {
  const formData = await imageFormData(payload, files);
  const data = await apiFetch("/api/admin/places", { method: "POST", body: formData });
  return data.queryCode;
}

export async function loadPendingImageUrls(paths = []) {
  return paths.filter(Boolean).map((path) => ({ path, url: path }));
}

export async function removePendingImage(placeId, path) {
  await apiFetch(`/api/admin/places/${encodeURIComponent(requirePlaceId(placeId))}/pending-images`, {
    method: "DELETE",
    body: JSON.stringify({ path }),
  });
}

export async function uploadPublishedImages(placeId, files = []) {
  if (!files.length) return;
  const validFiles = await Promise.all(files.map((file) => compressImageToWebp(file)));
  const formData = new FormData();
  validFiles.forEach((file) => formData.append("images", file, file.name));
  await apiFetch(`/api/admin/places/${encodeURIComponent(requirePlaceId(placeId))}/images`, {
    method: "POST",
    body: formData,
  });
}

export async function removePublishedImage(placeId, imageUrl) {
  await apiFetch(`/api/admin/places/${encodeURIComponent(requirePlaceId(placeId))}/images`, {
    method: "DELETE",
    body: JSON.stringify({ url: imageUrl }),
  });
}

export async function setPublishedCover(placeId, imageUrl) {
  await apiFetch(`/api/admin/places/${encodeURIComponent(requirePlaceId(placeId))}/cover`, {
    method: "POST",
    body: JSON.stringify({ url: imageUrl }),
  });
}

export async function reviewPlace(id, status, rejectionReason = "", changes = {}) {
  return apiFetch(`/api/admin/places/${encodeURIComponent(requirePlaceId(id))}/review`, {
    method: "POST",
    body: JSON.stringify({ status, rejectionReason, changes }),
  });
}
