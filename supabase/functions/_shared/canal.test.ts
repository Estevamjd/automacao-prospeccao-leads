import { assertEquals } from "jsr:@std/assert@1";
import { canalUsaAssunto, ehCelular, ehFixo, emailPlausivel, escolherCanal, jaTemOptOut, rodapeDoCanal, telefonePlausivel } from "./canal.ts";

Deno.test("celular -> whatsapp", () => {
  assertEquals(escolherCanal({ main_phone: "+55 21 99999-8888" }), "whatsapp");
});

Deno.test("REGRESSAO 23/09: fixo -> ligacao, nao whatsapp", () => {
  // 14 das 15 mensagens "de WhatsApp" iam para fixo e apareciam sem botao.
  assertEquals(escolherCanal({ main_phone: "+55 21 3391-4455" }), "phone");
  assertEquals(escolherCanal({ main_phone: "(21) 2560 4084" }), "phone");
});

Deno.test("classificacao de numero: celular x fixo", () => {
  assertEquals(ehCelular("+55 21 994608631"), true);
  assertEquals(ehCelular("021994608631"), true);
  assertEquals(ehCelular("+55 21 3391-4455"), false);
  assertEquals(ehFixo("+55 21 3391-4455"), true);
  assertEquals(ehFixo("+55 21 994608631"), false);
  assertEquals(ehFixo("0800 123 4567"), false);
});

Deno.test("fixo com sinal de whatsapp continua whatsapp", () => {
  assertEquals(escolherCanal({ main_phone: "2130000001", signals: { has_whatsapp: true } }), "whatsapp");
});

Deno.test("so e-mail -> email", () => {
  assertEquals(escolherCanal({ main_email: "contato@padaria.com.br" }), "email");
});

Deno.test("REGRESSAO: telefone E e-mail -> telefone ganha (o bug marcava email)", () => {
  assertEquals(
    escolherCanal({ main_phone: "21999998888", main_email: "contato@x.com" }),
    "whatsapp",
  );
  assertEquals(
    escolherCanal({ main_phone: "2125551234", main_email: "contato@x.com" }),
    "phone",
  );
});

Deno.test("telefone lixo nao vale como canal; cai no e-mail", () => {
  assertEquals(escolherCanal({ main_phone: "n/a", main_email: "a@b.com" }), "email");
  assertEquals(escolherCanal({ main_phone: "123", main_email: "a@b.com" }), "email");
});

Deno.test("e-mail lixo nao vira canal", () => {
  assertEquals(emailPlausivel("-"), false);
  assertEquals(emailPlausivel("sem-arroba.com"), false);
  assertEquals(emailPlausivel("a@b"), false);
  assertEquals(emailPlausivel("contato@padaria.com.br"), true);
});

Deno.test("sinal has_whatsapp sozinho basta", () => {
  assertEquals(escolherCanal({ signals: { has_whatsapp: true } }), "whatsapp");
});

Deno.test("sem contato nenhum: default seguro whatsapp", () => {
  assertEquals(escolherCanal({}), "whatsapp");
});

Deno.test("telefone com prefixo de tronco 0 e com +55", () => {
  assertEquals(telefonePlausivel("021999998888"), true);
  assertEquals(telefonePlausivel("+5521999998888"), true);
  assertEquals(telefonePlausivel("(21) 2555-1234"), true);
  assertEquals(telefonePlausivel("5599998888"), true); // DDD 55, 10 digitos
});

Deno.test("assunto so em e-mail", () => {
  assertEquals(canalUsaAssunto("email"), true);
  assertEquals(canalUsaAssunto("whatsapp"), false);
});

Deno.test("rodape de ligacao e vazio: a saida esta no roteiro", () => {
  assertEquals(rodapeDoCanal("phone", { nome: "Estevam" }), "");
});

Deno.test("rodape de whatsapp e curto e oferece saida", () => {
  const r = rodapeDoCanal("whatsapp", { nome: "Estevam" });
  // o nome ja esta na primeira linha da mensagem; nao assina de novo
  assertEquals(r.includes("Estevam"), false);
  assertEquals(r.toLowerCase().includes("não quiser receber"), true);
  assertEquals(r.length < 130, true); // no zap, rodape longo vira spam
});

Deno.test("rodape de e-mail cita a base legal e o jeito de sair", () => {
  const r = rodapeDoCanal("email", { nome: "Estevam", contato: "eu@exemplo.com" });
  assertEquals(r.includes("LGPD"), true);
  assertEquals(r.includes("art. 7º, IX"), true);
  assertEquals(r.includes("eu@exemplo.com"), true);
});

Deno.test("rodape funciona sem identificacao configurada", () => {
  const r = rodapeDoCanal("email");
  assertEquals(r.includes("undefined"), false);
  assertEquals(r.includes("LGPD"), true);
});

Deno.test("jaTemOptOut reconhece pedido de descadastro ja presente", () => {
  assertEquals(jaTemOptOut("Oi! Se não quiser receber, avisa."), true);
  assertEquals(jaTemOptOut("Se preferir, me tira da lista"), false);
  assertEquals(jaTemOptOut("Oi, tudo bem? Vi a padaria aqui."), false);
  assertEquals(jaTemOptOut(rodapeDoCanal("whatsapp", { nome: "X" })), true);
  assertEquals(jaTemOptOut(rodapeDoCanal("email")), true);
});
