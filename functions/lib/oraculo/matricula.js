"use strict";
/**
 * Payload de matrícula do Oráculo.
 * Função pura: não chama o Oráculo, não lê segredo e não grava pagamento.
 * O bloco financeiro (cartão, TID, NSU, autorização) não entra neste objeto.
 * Quem for enviar só pode chamar isto depois de orders.paymentStatus = paid.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OraculoMatriculaError = void 0;
exports.mapOraculoMatriculas = mapOraculoMatriculas;
class OraculoMatriculaError extends Error {
    constructor(message) {
        super(message);
        this.name = "OraculoMatriculaError";
    }
}
exports.OraculoMatriculaError = OraculoMatriculaError;
const FIELDS = [
    "idoferta",
    "idcurso",
    "idcfc",
    "idturma",
    "idatendente",
    "valor_contrato",
    "nome",
    "documentoaluno",
    "email",
    "celular",
    "cep",
    "endereco",
    "numero",
    "bairro",
    "estado",
    "cidade",
    "complemento",
    "pais",
    "rg",
    "data_nasc",
    "cnh",
    "categoria",
    "renach",
];
function invalid(label) {
    throw new OraculoMatriculaError(`${label} é inválido.`);
}
function requiredText(value, label, max) {
    if (typeof value !== "string")
        invalid(label);
    const text = value.trim();
    if (!text || text.length > max)
        invalid(label);
    return text;
}
function optionalText(value, label, max) {
    if (value == null || value === "")
        return "";
    if (typeof value !== "string")
        invalid(label);
    const text = value.trim();
    if (text.length > max)
        invalid(label);
    return text;
}
function digits(value, label, min, max) {
    if (typeof value !== "string")
        invalid(label);
    const only = value.replace(/\D/g, "");
    if (only.length < min || only.length > max)
        invalid(label);
    return only;
}
function valorContrato(cents) {
    if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents <= 0) {
        invalid("Valor do contrato");
    }
    const whole = Math.trunc(cents / 100);
    const fraction = String(cents % 100).padStart(2, "0");
    return `${whole}.${fraction}`;
}
function realDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    return (date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day);
}
/** Aceita AAAA-MM-DD (cadastro atual) ou DD/MM/AAAA e grava DD/MM/AAAA. */
function dataNasc(value) {
    if (typeof value !== "string")
        invalid("Data de nascimento");
    const text = value.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    const year = Number(iso?.[1] ?? br?.[3]);
    const month = Number(iso?.[2] ?? br?.[2]);
    const day = Number(iso?.[3] ?? br?.[1]);
    if ((!iso && !br) || !realDate(year, month, day)) {
        invalid("Data de nascimento");
    }
    const dd = String(day).padStart(2, "0");
    const mm = String(month).padStart(2, "0");
    return `${dd}/${mm}/${year}`;
}
function integrationId(integration, key) {
    return requiredText(integration?.[key], key, 20);
}
/**
 * Monta `{ matriculas: [um aluno] }` com os campos combinados com o ICETRAN.
 * Não inclui financeiro nem dado de cartão, mesmo se o objeto de entrada tiver.
 */
function mapOraculoMatriculas(input) {
    if (!input || typeof input !== "object" || !input.integration) {
        invalid("Matrícula");
    }
    const email = requiredText(input.email, "E-mail", 180).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        invalid("E-mail");
    const estado = requiredText(input.estado, "Estado", 2).toUpperCase();
    if (!/^[A-Z]{2}$/.test(estado))
        invalid("Estado");
    const categoria = requiredText(input.categoria, "Categoria", 3).toUpperCase();
    if (!/^[A-Z]{1,3}$/.test(categoria))
        invalid("Categoria");
    const matricula = {
        idoferta: integrationId(input.integration, "idoferta"),
        idcurso: integrationId(input.integration, "idcurso"),
        idcfc: integrationId(input.integration, "idcfc"),
        idturma: integrationId(input.integration, "idturma"),
        idatendente: integrationId(input.integration, "idatendente"),
        valor_contrato: valorContrato(input.valorContratoCents),
        nome: requiredText(input.nome, "Nome", 120),
        documentoaluno: digits(input.documentoAluno, "Documento do aluno", 11, 11),
        email,
        celular: digits(input.celular, "Celular", 10, 13),
        cep: digits(input.cep, "CEP", 8, 8),
        endereco: requiredText(input.endereco, "Endereço", 150),
        numero: requiredText(input.numero, "Número", 15),
        bairro: requiredText(input.bairro, "Bairro", 100),
        estado,
        cidade: requiredText(input.cidade, "Cidade", 100),
        complemento: optionalText(input.complemento, "Complemento", 100),
        pais: optionalText(input.pais, "País", 40) || "Brasil",
        rg: optionalText(input.rg, "RG", 20),
        data_nasc: dataNasc(input.dataNasc),
        cnh: digits(input.cnh, "CNH", 9, 12),
        categoria,
        renach: optionalText(input.renach, "RENACH", 20),
    };
    const payload = {};
    for (const field of FIELDS)
        payload[field] = matricula[field];
    return { matriculas: [payload] };
}
