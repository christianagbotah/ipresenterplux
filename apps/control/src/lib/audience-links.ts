import QRCode from "qrcode";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function canonicalAudienceUrl(origin: string, serviceId: string) {
  const parsedOrigin = new URL(origin);
  const url = new URL("/live", parsedOrigin.origin);
  url.searchParams.set("service", serviceId);
  return url.toString();
}

export async function audienceQrSvg(url: string) {
  const svg = await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    color: { dark: "#080b10", light: "#ffffff" }
  });
  return svg.replace(">", `><desc>${escapeXml(url)}</desc>`);
}
