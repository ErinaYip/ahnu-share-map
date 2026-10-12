import { useEffect } from "react";

// 本地部署不再依赖 Cloudflare Turnstile：直接放行一个占位 token。
// 保留组件是为了不修改 SubmissionForm 的调用方式，也方便后续需要时再接回人机验证。
export default function Turnstile({ onToken }) {
  useEffect(() => {
    onToken?.("local");
  }, [onToken]);
  return null;
}
