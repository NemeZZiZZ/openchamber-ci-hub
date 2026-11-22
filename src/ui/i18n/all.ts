// Every catalog in every locale: the panel's set, and the one the tests check.

import { ar, plurals as pluralsAr } from './ar.ts';
import { de, plurals as pluralsDe } from './de.ts';
import { en, plurals as pluralsEn, type Strings } from './en.ts';
import { es, plurals as pluralsEs } from './es.ts';
import { fr, plurals as pluralsFr } from './fr.ts';
import { he, plurals as pluralsHe } from './he.ts';
import { ja, plurals as pluralsJa } from './ja.ts';
import { ko, plurals as pluralsKo } from './ko.ts';
import { nl, plurals as pluralsNl } from './nl.ts';
import { pl, plurals as pluralsPl } from './pl.ts';
import { ru, plurals as pluralsRu } from './ru.ts';
import { zhCn, plurals as pluralsZhCn } from './zh-CN.ts';
import { zhTw, plurals as pluralsZhTw } from './zh-TW.ts';
import { ptBr, plurals as pluralsPtBr } from './pt-BR.ts';
import { tr, plurals as pluralsTr } from './tr.ts';
import { uk, plurals as pluralsUk } from './uk.ts';
import type { Catalogs, PluralTable } from '../i18n.ts';

export const locales: Record<string, Strings> = {
  en,
  de,
  fr,
  'zh-CN': zhCn,
  'zh-TW': zhTw,
  uk,
  es,
  'pt-BR': ptBr,
  ko,
  pl,
  ja,
  tr,
  nl,
  he,
  ar,
  ru,
};

export const pluralTables: Record<string, PluralTable> = {
  en: pluralsEn,
  de: pluralsDe,
  fr: pluralsFr,
  'zh-CN': pluralsZhCn,
  'zh-TW': pluralsZhTw,
  uk: pluralsUk,
  es: pluralsEs,
  'pt-BR': pluralsPtBr,
  ko: pluralsKo,
  pl: pluralsPl,
  ja: pluralsJa,
  tr: pluralsTr,
  nl: pluralsNl,
  he: pluralsHe,
  ar: pluralsAr,
  ru: pluralsRu,
};

export const allCatalogs: Catalogs = { strings: locales, plurals: pluralTables };
