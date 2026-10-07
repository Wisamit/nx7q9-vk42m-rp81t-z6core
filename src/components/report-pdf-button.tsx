"use client";

import { useState } from "react";

function safeFileName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "report";
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("PDF_IMAGE_LOAD_FAILED"));
    image.src = dataUrl;
  });
}

async function sha256Hex(blob: Blob) {
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function ReportPdfButton({
  reportVersionId,
  accessionNumber,
  reportVersion,
  showPageNumbers,
  locale,
  targetId = "diagnostic-report-version",
}: {
  reportVersionId: string;
  accessionNumber: string;
  reportVersion: number;
  showPageNumbers: boolean;
  locale: "ar" | "en";
  targetId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function downloadPdf() {
    if (busy) return;
    setBusy(true);
    setMessage("");

    const node = document.getElementById(targetId);
    if (!node) {
      setMessage(tr("Report surface was not found.", "تعذر العثور على مساحة التقرير."));
      setBusy(false);
      return;
    }

    try {
      if ("fonts" in document) await document.fonts.ready;
      node.classList.add("pdf-exporting");
      const pdfSurface = getComputedStyle(node).getPropertyValue("--fl-report-pdf-surface").trim();
      if (!pdfSurface) throw new Error("PDF_SURFACE_COLOR_MISSING");

      const [{ toPng }, { jsPDF }] = await Promise.all([
        import("html-to-image"),
        import("jspdf"),
      ]);

      const dataUrl = await toPng(node, {
        cacheBust: true,
        pixelRatio: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
        backgroundColor: pdfSurface,
        filter: candidate => !(candidate instanceof HTMLElement && candidate.classList.contains("no-print")),
      });

      const image = await loadImage(dataUrl);
      const pageWidthMm = 210;
      const pageHeightMm = 297;
      const marginMm = 7;
      const contentWidthMm = pageWidthMm - marginMm * 2;
      const contentHeightMm = pageHeightMm - marginMm * 2 - (showPageNumbers ? 5 : 0);
      const pagePixelHeight = Math.max(1, Math.floor(image.width * (contentHeightMm / contentWidthMm)));
      const pageCount = Math.max(1, Math.ceil(image.height / pagePixelHeight));

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
        compress: true,
      });

      for (let page = 0; page < pageCount; page++) {
        if (page > 0) pdf.addPage("a4", "portrait");

        const sourceY = page * pagePixelHeight;
        const sliceHeight = Math.min(pagePixelHeight, image.height - sourceY);
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = sliceHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("PDF_CANVAS_UNAVAILABLE");

        context.fillStyle = pdfSurface;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(
          image,
          0,
          sourceY,
          image.width,
          sliceHeight,
          0,
          0,
          image.width,
          sliceHeight,
        );

        const sliceData = canvas.toDataURL("image/jpeg", 0.95);
        const renderedHeightMm = (sliceHeight / image.width) * contentWidthMm;
        pdf.addImage(sliceData, "JPEG", marginMm, marginMm, contentWidthMm, renderedHeightMm, undefined, "FAST");

        if (showPageNumbers) {
          pdf.setFontSize(8);
          pdf.setTextColor(90, 90, 90);
          pdf.text(`${page + 1} / ${pageCount}`, pageWidthMm / 2, pageHeightMm - 4, { align: "center" });
        }
      }

      const pdfBlob = pdf.output("blob");
      const fileName = `${safeFileName(accessionNumber)}_v${reportVersion}.pdf`;
      const checksum = await sha256Hex(pdfBlob);

      const logResponse = await fetch(`/api/reports/${reportVersionId}/delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "DOWNLOAD",
          status: "DELIVERED",
          details: {
            fileName,
            mimeType: "application/pdf",
            sha256: checksum,
            pageCount,
            renderer: "browser-dom-raster-v1",
          },
        }),
      });
      if (!logResponse.ok) throw new Error("PDF_DELIVERY_LOG_FAILED");

      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      setMessage(tr("PDF downloaded and recorded in delivery history.", "تم تنزيل ملف PDF وتسجيله في سجل التسليم."));
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setMessage(code === "PDF_DELIVERY_LOG_FAILED"
        ? tr("PDF was generated but could not be audit-logged, so download was blocked.", "تم إنشاء PDF لكن تعذر تسجيله في سجل التدقيق، لذلك تم منع التنزيل.")
        : tr("Could not generate the PDF. Check report images/assets and try again.", "تعذر إنشاء ملف PDF. تحقق من صور/عناصر التقرير ثم أعد المحاولة."));
    } finally {
      node.classList.remove("pdf-exporting");
      setBusy(false);
    }
  }

  return <span className="report-pdf-action">
    <button className="secondary-button no-print" type="button" disabled={busy} onClick={() => void downloadPdf()}>
      {busy ? tr("Generating PDF…", "جارٍ إنشاء PDF…") : tr("Download PDF", "تنزيل PDF")}
    </button>
    {message && <small className="muted">{message}</small>}
  </span>;
}
