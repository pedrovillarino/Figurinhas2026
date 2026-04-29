/**
 * Brazilian DDD → city/state mapping.
 *
 * Used to infer a coarse location for users who set up a phone number but
 * never granted geolocation. The result is the major reference city for the
 * area code (capital or largest city in the DDD region) and the state.
 *
 * This is intentionally city-only (not lat/lng): a DDD covers an entire
 * region, so any single coordinate would be misleading. When the user later
 * either grants GPS or types a precise neighborhood, those override these
 * inferred values.
 */

export type DddInfo = { city: string; state: string }

const DDD_MAP: Record<string, DddInfo> = {
  // São Paulo
  '11': { city: 'São Paulo', state: 'São Paulo' },
  '12': { city: 'São José dos Campos', state: 'São Paulo' },
  '13': { city: 'Santos', state: 'São Paulo' },
  '14': { city: 'Bauru', state: 'São Paulo' },
  '15': { city: 'Sorocaba', state: 'São Paulo' },
  '16': { city: 'Ribeirão Preto', state: 'São Paulo' },
  '17': { city: 'São José do Rio Preto', state: 'São Paulo' },
  '18': { city: 'Presidente Prudente', state: 'São Paulo' },
  '19': { city: 'Campinas', state: 'São Paulo' },
  // Rio de Janeiro
  '21': { city: 'Rio de Janeiro', state: 'Rio de Janeiro' },
  '22': { city: 'Campos dos Goytacazes', state: 'Rio de Janeiro' },
  '24': { city: 'Volta Redonda', state: 'Rio de Janeiro' },
  // Espírito Santo
  '27': { city: 'Vitória', state: 'Espírito Santo' },
  '28': { city: 'Cachoeiro de Itapemirim', state: 'Espírito Santo' },
  // Minas Gerais
  '31': { city: 'Belo Horizonte', state: 'Minas Gerais' },
  '32': { city: 'Juiz de Fora', state: 'Minas Gerais' },
  '33': { city: 'Governador Valadares', state: 'Minas Gerais' },
  '34': { city: 'Uberlândia', state: 'Minas Gerais' },
  '35': { city: 'Poços de Caldas', state: 'Minas Gerais' },
  '37': { city: 'Divinópolis', state: 'Minas Gerais' },
  '38': { city: 'Montes Claros', state: 'Minas Gerais' },
  // Paraná
  '41': { city: 'Curitiba', state: 'Paraná' },
  '42': { city: 'Ponta Grossa', state: 'Paraná' },
  '43': { city: 'Londrina', state: 'Paraná' },
  '44': { city: 'Maringá', state: 'Paraná' },
  '45': { city: 'Cascavel', state: 'Paraná' },
  '46': { city: 'Francisco Beltrão', state: 'Paraná' },
  // Santa Catarina
  '47': { city: 'Joinville', state: 'Santa Catarina' },
  '48': { city: 'Florianópolis', state: 'Santa Catarina' },
  '49': { city: 'Chapecó', state: 'Santa Catarina' },
  // Rio Grande do Sul
  '51': { city: 'Porto Alegre', state: 'Rio Grande do Sul' },
  '53': { city: 'Pelotas', state: 'Rio Grande do Sul' },
  '54': { city: 'Caxias do Sul', state: 'Rio Grande do Sul' },
  '55': { city: 'Santa Maria', state: 'Rio Grande do Sul' },
  // Centro-Oeste
  '61': { city: 'Brasília', state: 'Distrito Federal' },
  '62': { city: 'Goiânia', state: 'Goiás' },
  '63': { city: 'Palmas', state: 'Tocantins' },
  '64': { city: 'Rio Verde', state: 'Goiás' },
  '65': { city: 'Cuiabá', state: 'Mato Grosso' },
  '66': { city: 'Rondonópolis', state: 'Mato Grosso' },
  '67': { city: 'Campo Grande', state: 'Mato Grosso do Sul' },
  // Norte
  '68': { city: 'Rio Branco', state: 'Acre' },
  '69': { city: 'Porto Velho', state: 'Rondônia' },
  // Bahia
  '71': { city: 'Salvador', state: 'Bahia' },
  '73': { city: 'Itabuna', state: 'Bahia' },
  '74': { city: 'Juazeiro', state: 'Bahia' },
  '75': { city: 'Feira de Santana', state: 'Bahia' },
  '77': { city: 'Vitória da Conquista', state: 'Bahia' },
  // Sergipe
  '79': { city: 'Aracaju', state: 'Sergipe' },
  // Pernambuco / Alagoas / Paraíba / Rio Grande do Norte / Ceará / Piauí
  '81': { city: 'Recife', state: 'Pernambuco' },
  '82': { city: 'Maceió', state: 'Alagoas' },
  '83': { city: 'João Pessoa', state: 'Paraíba' },
  '84': { city: 'Natal', state: 'Rio Grande do Norte' },
  '85': { city: 'Fortaleza', state: 'Ceará' },
  '86': { city: 'Teresina', state: 'Piauí' },
  '87': { city: 'Petrolina', state: 'Pernambuco' },
  '88': { city: 'Juazeiro do Norte', state: 'Ceará' },
  '89': { city: 'Picos', state: 'Piauí' },
  // Norte
  '91': { city: 'Belém', state: 'Pará' },
  '92': { city: 'Manaus', state: 'Amazonas' },
  '93': { city: 'Santarém', state: 'Pará' },
  '94': { city: 'Marabá', state: 'Pará' },
  '95': { city: 'Boa Vista', state: 'Roraima' },
  '96': { city: 'Macapá', state: 'Amapá' },
  '97': { city: 'Tefé', state: 'Amazonas' },
  // Maranhão
  '98': { city: 'São Luís', state: 'Maranhão' },
  '99': { city: 'Imperatriz', state: 'Maranhão' },
}

/**
 * Extract the DDD from a Brazilian phone (any format: with/without country
 * code, with/without separators) and look up the reference city/state.
 *
 * Returns null if:
 *  - phone is empty/null
 *  - phone has fewer than 10 digits after stripping (Brazilian local numbers
 *    are at least DDD + 8 digits)
 *  - the extracted DDD isn't in the map (e.g. invented number, foreign number)
 *
 * Examples:
 *   inferCityFromPhone('5521997838210') → { city: 'Rio de Janeiro', state: 'Rio de Janeiro' }
 *   inferCityFromPhone('11 99999-8888')  → { city: 'São Paulo',     state: 'São Paulo' }
 *   inferCityFromPhone('+1 555 1234')    → null
 */
export function inferCityFromPhone(phone: string | null | undefined): DddInfo | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  // Strip country code 55 if present and the number is long enough.
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits
  if (local.length < 10) return null
  const ddd = local.slice(0, 2)
  return DDD_MAP[ddd] ?? null
}
