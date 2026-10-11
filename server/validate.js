// 投稿字段校验：尽量对齐原 Supabase Edge Function 的约束。
export const COORDINATE_BOUNDS = {
  latitude: [0.8293, 55.8271],
  longitude: [72.004, 137.8347],
};

export class InputError extends Error {}

const fail = (message) => {
  throw new InputError(message);
};

export function stringValue(value, field, maxLength, required = false) {
  if (value === null || value === undefined || typeof value === "object")
    return required ? fail(`${field}不能为空`) : null;
  const trimmed = String(value).trim();
  if (required && !trimmed) fail(`${field}不能为空`);
  if (trimmed.length > maxLength) fail(`${field}长度不能超过${maxLength}个字符`);
  return trimmed || null;
}

function coordinateValue(value, field, minimum, maximum) {
  if (value === null || value === undefined || value === "") fail(`${field}无效`);
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < minimum || numericValue > maximum)
    fail(`${field}无效`);
  return numericValue;
}

export function normalizePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    fail("投稿数据格式错误");
  const latitude = coordinateValue(
    payload.latitude,
    "纬度",
    ...COORDINATE_BOUNDS.latitude,
  );
  const longitude = coordinateValue(
    payload.longitude,
    "经度",
    ...COORDINATE_BOUNDS.longitude,
  );

  const customSource = payload.custom_details;
  if (
    customSource !== undefined &&
    (customSource === null ||
      typeof customSource !== "object" ||
      Array.isArray(customSource))
  )
    fail("自定义项格式错误");
  const customEntries = Object.entries(customSource || {});
  if (customEntries.length > 20) fail("自定义项不能超过20个");
  const customDetails = {};
  for (const [key, value] of customEntries) {
    if (key === "duplicate_candidates") continue;
    if (key.length > 50) fail("自定义项名称过长");
    if (key === "images") {
      if (
        !Array.isArray(value) ||
        value.length > 3 ||
        value.some((path) => typeof path !== "string" || path.length > 255)
      )
        fail("图片路径无效");
      customDetails.images = value;
      continue;
    }
    if (typeof value !== "string" || value.length > 500)
      fail("自定义项内容无效");
    customDetails[key] = value;
  }

  return {
    name: stringValue(payload.name, "地名", 120, true),
    recommendation: stringValue(payload.recommendation, "推荐理由", 2000, true),
    category_id: stringValue(payload.category_id, "分类", 64),
    latitude,
    longitude,
    address: stringValue(payload.address, "地址", 240),
    hours: stringValue(payload.hours, "营业时间", 120),
    price: stringValue(payload.price, "价格", 120),
    best_for: stringValue(payload.best_for, "适合场景", 120),
    custom_details: customDetails,
  };
}
