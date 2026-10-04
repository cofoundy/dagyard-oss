// El detector de idioma del mod: el mismo criterio que el CLI (#73).
import { expect, test } from 'claude-code/testing'

import { langFromEnv, REQUEST_CHANGES, text } from './i18n'

test('LC_ALL > LC_MESSAGES > LANG; manda el primero no vacío', () => {
  expect(langFromEnv({ LANG: 'es_PE.UTF-8' })).toBe('es')
  expect(langFromEnv({ LANG: 'es' })).toBe('es')
  expect(langFromEnv({ LANG: 'es-419' })).toBe('es')
  expect(langFromEnv({ LANG: 'en_US.UTF-8' })).toBe('en')
  expect(langFromEnv({ LANG: 'en_US.UTF-8', LC_ALL: 'es_PE.UTF-8' })).toBe('es')
  expect(langFromEnv({ LANG: 'es_PE.UTF-8', LC_ALL: 'en_US.UTF-8' })).toBe('en')
  expect(langFromEnv({ LANG: 'en_US.UTF-8', LC_MESSAGES: 'es_ES.UTF-8' })).toBe('es')
  expect(langFromEnv({ LANG: 'es_PE.UTF-8', LC_ALL: '', LC_MESSAGES: null })).toBe('es')
})

test('C, POSIX, otro idioma o nada → inglés', () => {
  expect(langFromEnv({ LANG: 'C' })).toBe('en')
  expect(langFromEnv({ LANG: 'POSIX' })).toBe('en')
  expect(langFromEnv({ LANG: 'et_EE.UTF-8' })).toBe('en')
  expect(langFromEnv({})).toBe('en')
})

test('los dos diccionarios tienen las mismas claves', () => {
  expect(Object.keys(text('en')).sort()).toEqual(Object.keys(text('es')).sort())
  expect(text('en').waitingLabel('access')).toBe('Needs an access')
  expect(text('es').waitingLabel('access')).toBe('Te espera un acceso')
})

test('«Pedir cambios» se reconoce en los dos idiomas', () => {
  expect(REQUEST_CHANGES.test('Pedir cambios')).toBe(true)
  expect(REQUEST_CHANGES.test('Request changes')).toBe(true)
  expect(REQUEST_CHANGES.test('Aprobar')).toBe(false)
  expect(REQUEST_CHANGES.test('Approve')).toBe(false)
})
