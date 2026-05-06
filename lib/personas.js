function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalStringArray(value) {
  return value == null || (
    Array.isArray(value)
    && value.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

export function validatePersonas(personas) {
  if (!Array.isArray(personas) || !personas.length) {
    throw new Error('personas.json esta vazio ou invalido.');
  }

  const seenIds = new Set();

  personas.forEach((persona, index) => {
    if (!isNonEmptyString(persona.id)) throw new Error(`persona ${index + 1}: campo "id" ausente ou invalido.`);
    if (!isNonEmptyString(persona.nome)) throw new Error(`persona ${index + 1}: campo "nome" ausente ou invalido.`);
    if (!isNonEmptyString(persona.descricao)) {
      throw new Error(`persona ${index + 1}: campo "descricao" ausente ou invalido.`);
    }

    const trimmedId = persona.id.trim();
    if (seenIds.has(trimmedId)) throw new Error(`persona ${trimmedId}: campo "id" duplicado.`);
    seenIds.add(trimmedId);

    if (!isOptionalStringArray(persona.prioridades)) {
      throw new Error(`persona ${persona.id}: campo "prioridades" invalido.`);
    }
    if (!isOptionalStringArray(persona.evitar)) {
      throw new Error(`persona ${persona.id}: campo "evitar" invalido.`);
    }
  });

  return personas;
}
