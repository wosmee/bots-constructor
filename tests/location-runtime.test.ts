// Тесты runtime блока location: чтение гео из апдейта.
import { describe, it, expect } from 'vitest';
import { readLocationFromUpdate } from '../worker/src/blocks/location/runtime';

describe('readLocationFromUpdate', () => {
  it('числовые latitude/longitude из message.location', () => {
    const u = { message: { location: { latitude: 55.751244, longitude: 37.618492 } } };
    expect(readLocationFromUpdate(u)).toEqual({ lat: 55.751244, lon: 37.618492 });
  });

  it('edited_message.location тоже читается', () => {
    const u = { edited_message: { location: { latitude: 59.93, longitude: 30.31 } } };
    expect(readLocationFromUpdate(u)).toEqual({ lat: 59.93, lon: 30.31 });
  });

  it('строковые числа поддерживаются', () => {
    const u = { message: { location: { latitude: '55.75', longitude: '37.61' } } };
    expect(readLocationFromUpdate(u)).toEqual({ lat: 55.75, lon: 37.61 });
  });

  it('текстовый апдейт без location → null', () => {
    expect(readLocationFromUpdate({ message: { text: 'привет' } })).toBeNull();
  });

  it('callback_query → null', () => {
    expect(readLocationFromUpdate({ callback_query: { data: 'go', message: { text: 'x' } } })).toBeNull();
  });

  it('некорректные координаты → null', () => {
    expect(readLocationFromUpdate({ message: { location: { latitude: 'abc', longitude: 37.6 } } })).toBeNull();
    expect(readLocationFromUpdate({ message: { location: {} } })).toBeNull();
  });

  it('null/undefined апдейт → null', () => {
    expect(readLocationFromUpdate(null)).toBeNull();
    expect(readLocationFromUpdate(undefined)).toBeNull();
  });
});
