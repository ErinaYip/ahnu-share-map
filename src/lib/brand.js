// 白标核心逻辑：解析品牌配置，并把它渲染进 index.html。
// 该模块同时被浏览器（src/main.jsx）与构建脚本（vite.config.js）使用，因此不能依赖 fs 或 DOM。

export function parseScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )
    return trimmed.slice(1, -1);
  if (trimmed.startsWith("[") && trimmed.endsWith("]"))
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => {
        const token = item.trim().replace(/^['"]|['"]$/g, "");
        return /^\d+(\.\d+)?$/.test(token) ? Number(token) : token;
      })
      .filter(Boolean);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

export function parseYaml(text) {
  const rows = [];
  let current = null;
  text.split(/\r?\n/).forEach((line) => {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) return;
    if (clean.startsWith("- ")) {
      if (current) rows.push(current);
      current = {};
      const first = clean.slice(2).match(/^([^:]+):\s*(.*)$/);
      if (first) current[first[1].trim()] = parseScalar(first[2]);
      return;
    }
    const match = clean.match(/^([^:]+):\s*(.*)$/);
    if (match && current) current[match[1].trim()] = parseScalar(match[2]);
  });
  if (current) rows.push(current);
  return rows;
}

// 未配置字段的兜底值，保证 brand 对象结构完整。
export const defaultBrand = {
  name: "生活地图",
  shortName: "校园",
  englishName: "CAMPUS · LIFE MAP",
  institution: "",
  slogan: "学长学姐分享",
  description: "校园生活、美食与娱乐推荐地图。",
  shareDescription: "发现校园内外值得去的美食与娱乐地点。",
  url: "",
  logo: "logo.png",
  guideTitle: "三步开始探索",
  quoteLabel: "学长学姐说",
  storageKey: "share-map",
  contactQqLabel: "QQ",
  contactQqValue: "",
  contactQqHref: "",
  contactSiteLabel: "个人主页",
  contactSiteValue: "",
  contactSiteHref: "",
  contactGithubLabel: "GitHub",
  contactGithubValue: "",
  contactGithubHref: "",
};

export function createBrand(config = {}) {
  return { ...defaultBrand, ...config };
}

const absoluteUrl = (base, path) => {
  const trimmed = String(base || "").trim();
  if (!trimmed) return "";
  try {
    return new URL(path, trimmed).href;
  } catch {
    return `${trimmed}${path}`;
  }
};

// 将品牌配置注入 index.html 的占位符，构建与 dev 时均由 Vite 调用。
export function renderIndexHtml(html, brand = defaultBrand) {
  const logoUrl = absoluteUrl(brand.url, brand.logo);
  const tokens = {
    "__BRAND_NAME__": brand.name,
    "__BRAND_ENGLISH_NAME__": brand.englishName,
    "__BRAND_SLOGAN__": brand.slogan,
    "__BRAND_DESCRIPTION__": brand.description,
    "__BRAND_SHARE_DESCRIPTION__": brand.shareDescription,
    "__BRAND_URL__": brand.url,
    "__BRAND_LOGO_URL__": logoUrl,
    "__BRAND_LOGO_ALT__": `${brand.name} Logo`,
  };
  return Object.entries(tokens).reduce(
    (result, [token, value]) => result.split(token).join(value),
    html,
  );
}
