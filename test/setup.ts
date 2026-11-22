// Unit tests run UI modules without a panel entry, so install every catalog
// the way panel/main.ts does.
import { installCatalogs } from '../src/ui/i18n.ts';
import { allCatalogs } from '../src/ui/i18n/all.ts';

installCatalogs(allCatalogs);
