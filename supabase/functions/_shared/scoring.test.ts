import { assertEquals } from "jsr:@std/assert@1";
import { aplicarRegras, prepararEmpresaParaRegras, validarRegra } from "./scoring.ts";

Deno.test("regras v3 validam faixas e bloqueios", () => {
  const faixa = validarRegra({ field: "meses_aberta", operator: "between", range: [6, 36], points: 15, reason: "Aberta há {meses_aberta} meses" });
  const porte = validarRegra({ field: "porte", operator: "in", values: ["ME", "EPP"], points: 10 });
  const bloqueio = validarRegra({ field: "signals.is_chain", operator: "present", points: -50, bloqueia: true });
  assertEquals(faixa?.range, [6, 36]);
  assertEquals(validarRegra({ field: "meses_aberta", operator: "between", range: [36, 6], points: 15 }), null);
  const r = aplicarRegras({ meses_aberta: 18, porte: "ME", signals: { is_chain: false } }, [faixa!, porte!, bloqueio!]);
  assertEquals(r.score, 50);
  assertEquals(r.motivos, ["Aberta há 18 meses"]);
  assertEquals(r.bloqueada, false);
  assertEquals(aplicarRegras({ meses_aberta: 18, porte: "ME", signals: { is_chain: true } }, [faixa!, porte!, bloqueio!]).bloqueada, true);
});

Deno.test("site ausente na fonte não vira ausencia confirmada", () => {
  assertEquals(prepararEmpresaParaRegras({ website_url: null }).site_status, "nao_encontrado");
  assertEquals(prepararEmpresaParaRegras({ website_url: null,
    manual_overrides: { website_url: { confirmed_at: "2026-10-05T12:00:00Z" } } }).site_status, "conferido_sem");
  assertEquals(prepararEmpresaParaRegras({ website_url: "https://exemplo.com" }).site_status, "tem");
  assertEquals(prepararEmpresaParaRegras({ signals: {}, main_phone: "21999990000" }).tem_whatsapp, false);
});
