import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { mapOraculoMatriculas, OraculoMatriculaError } = require(
  "../lib/oraculo/matricula.js",
);

const FORBIDDEN = [
  "financeiro",
  "cartao",
  "cartão",
  "tid",
  "nsu",
  "autorizacao",
  "autorização",
  "numero_cartao",
  "cvv",
  "pan",
  "payment",
  "card",
];

function keysDeep(value, found = []) {
  if (!value || typeof value !== "object") return found;
  for (const key of Object.keys(value)) {
    found.push(key);
    keysDeep(value[key], found);
  }
  return found;
}

const aluno = {
  integration: {
    idoferta: "9001",
    idcurso: "9002",
    idcfc: "9003",
    idturma: "9004",
    idatendente: "9",
  },
  valorContratoCents: 12000,
  nome: "  Aluno Exemplo  ",
  documentoAluno: "529.982.247-25",
  email: "Aluno.Exemplo@example.com",
  celular: "(48) 99999-0000",
  cep: "88000-000",
  endereco: "Rua Exemplo",
  numero: "100",
  bairro: "Centro",
  estado: "sc",
  cidade: "Florianópolis",
  dataNasc: "1990-01-15",
  cnh: "123.456.789",
  categoria: "ab",
  cartao: "não pode vazar",
  financeiro: { tid: "1", nsu: "2" },
};

test("monta um envelope de matrícula sem financeiro", () => {
  const payload = mapOraculoMatriculas(aluno);

  assert.equal(payload.matriculas.length, 1);
  assert.deepEqual(payload.matriculas[0], {
    idoferta: "9001",
    idcurso: "9002",
    idcfc: "9003",
    idturma: "9004",
    idatendente: "9",
    valor_contrato: "120.00",
    nome: "Aluno Exemplo",
    documentoaluno: "52998224725",
    email: "aluno.exemplo@example.com",
    celular: "48999990000",
    cep: "88000000",
    endereco: "Rua Exemplo",
    numero: "100",
    bairro: "Centro",
    estado: "SC",
    cidade: "Florianópolis",
    complemento: "",
    pais: "Brasil",
    rg: "",
    data_nasc: "15/01/1990",
    cnh: "123456789",
    categoria: "AB",
    renach: "",
  });

  const keys = keysDeep(payload);
  for (const forbidden of FORBIDDEN) {
    assert.equal(keys.includes(forbidden), false, forbidden);
  }
});

test("o valor de contrato vem dos centavos informados", () => {
  const payload = mapOraculoMatriculas({
    ...aluno,
    valorContratoCents: 22900,
    dataNasc: "15/01/1990",
    rg: "1234567",
    renach: "SC123456789",
    complemento: "Apto 2",
    pais: "Brasil",
  });
  const matricula = payload.matriculas[0];
  assert.equal(matricula.valor_contrato, "229.00");
  assert.equal(matricula.data_nasc, "15/01/1990");
  assert.equal(matricula.rg, "1234567");
  assert.equal(matricula.renach, "SC123456789");
  assert.equal(matricula.complemento, "Apto 2");
});

test("recusa data, valor e nome inválidos", () => {
  assert.throws(
    () => mapOraculoMatriculas({ ...aluno, dataNasc: "1990-02-31" }),
    OraculoMatriculaError,
  );
  assert.throws(
    () => mapOraculoMatriculas({ ...aluno, valorContratoCents: 0 }),
    OraculoMatriculaError,
  );
  assert.throws(
    () => mapOraculoMatriculas({ ...aluno, nome: " " }),
    OraculoMatriculaError,
  );
});
