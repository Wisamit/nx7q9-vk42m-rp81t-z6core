import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const src=readFileSync("src/components/order-create-form.tsx","utf8");
const submit=src.slice(src.indexOf("  async function submit("),src.indexOf("  return <form"));

test("F5: unknown order POST outcome permanently prevents a same-form retry",()=>{
  assert.ok(src.includes("const ambiguousSubmissionRef = useRef(false)"));
  assert.ok(src.includes("const [ambiguousSubmission, setAmbiguousSubmission] = useState(false)"));
  assert.ok(submit.includes("if (submitting.current || ambiguousSubmissionRef.current) return;"));
  assert.ok(submit.includes("response.status >= 500"));
  assert.ok(submit.includes("(response.ok && !confirmedReceipt)"));
  assert.ok(submit.includes('(!response.ok && (!body || typeof body.error !== "string"))'));
  assert.equal(submit.split("ambiguousSubmissionRef.current = true;").length-1,2);
  assert.equal(submit.split("setAmbiguousSubmission(true);").length-1,2);
  assert.ok(src.includes("disabled={busy || ambiguousSubmission}"));
  assert.ok(src.includes("role={ambiguousSubmission ? \"alert\" : undefined}"));
  assert.ok(src.includes("Duplicate order protection is active."));
});

test("F5: 2xx response only succeeds with order number, invoice number, currency and total",()=>{
  for(const part of [
    'typeof body.accessionNumber === "string"',
    'typeof body.invoiceNumber === "string"',
    'typeof body.currency === "string"',
    '(typeof body.total === "string" || typeof body.total === "number")',
  ])assert.ok(src.includes(part),part);
  assert.ok(submit.indexOf("const confirmedReceipt")<submit.indexOf("if (response.ok) {"));
  assert.ok(submit.includes("Do not submit this form again."));
  assert.ok(submit.includes("لا تعِد إرسال النموذج"));
  assert.ok(submit.includes("the order and invoice may already exist"));
  assert.ok(submit.includes("انقطع الاتصال وربما تم إنشاء الطلب والفاتورة"));
});

test("F5: accounting and clinical paths remain governed after adding uncertainty latch",()=>{
  const server=readFileSync("src/app/api/orders/route.ts","utf8");
  assert.ok(submit.includes('fetch("/api/orders"'));
  assert.ok(submit.includes("doctorRequisitionId"));
  assert.ok(submit.includes("discountApprovalRequestId"));
  assert.ok(submit.includes("selectedPackageIds"));
  assert.ok(submit.includes("answers,"));
  assert.ok(submit.includes("onSuccess?.(success)"));
  assert.ok(server.includes("invoiceNumber: result.invoice.invoiceNumber"));
  assert.ok(server.includes("accessionNumber: result.order.accessionNumber"));
  assert.ok(server.includes("total: result.total"));
});
