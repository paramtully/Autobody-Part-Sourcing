import { classifyIdentifier, mapEbayPosition, ClassifiedIdentifier } from './schema.ebay.item';

// ── classifyIdentifier ────────────────────────────────────────────────────────

describe('classifyIdentifier', () => {
  // [input, expected, description]
  const cases: Array<[string, ClassifiedIdentifier | null | undefined, string]> = [
    // Honda OEM — dashed and undashed formats
    ['04711-TBA-A90ZZ',  { type: 'OEM', manufacturer: 'Honda' },         'Honda dashed'],
    ['04711TBAA90ZZ',    { type: 'OEM', manufacturer: 'Honda' },         'Honda undashed'],
    // Ford OEM
    ['8G1Z13008F',       { type: 'OEM', manufacturer: 'Ford' },          'Ford'],
    // Nissan OEM — dashed and undashed
    ['62256-6CA0A',      { type: 'OEM', manufacturer: 'Nissan' },        'Nissan dashed'],
    ['622566CA0A',       { type: 'OEM', manufacturer: 'Nissan' },        'Nissan undashed'],
    // Mercedes-Benz OEM
    ['9068810101',       { type: 'OEM', manufacturer: 'Mercedes-Benz' }, 'Mercedes 10-digit'],
    // Toyota OEM (5-5 dashed)
    ['53811-12345',      { type: 'OEM', manufacturer: 'Toyota' },        'Toyota 5-hyphen-5'],
    // Hyundai/Kia shared Mobis-derived scheme
    ['92101D5000',       { type: 'OEM', manufacturer: 'Hyundai/Kia' },   'Hyundai/Kia ambiguous make'],
    // GM 8-digit (loosest pattern, kept last)
    ['84790367',         { type: 'OEM', manufacturer: 'GM' },            'GM 8-digit'],
    // Partslink prefixes
    ['NI1039163',        { type: 'AFTERMARKET', manufacturer: 'Nissan' }, 'Partslink NI → Nissan'],
    ['KI2502196',        { type: 'AFTERMARKET', manufacturer: 'Kia' },   'Partslink KI → Kia'],
    ['HO1000296',        { type: 'AFTERMARKET', manufacturer: 'Honda' }, 'Partslink HO → Honda'],
    ['FO1310243',        { type: 'AFTERMARKET', manufacturer: 'Ford' },  'Partslink FO → Ford'],
    ['TO1220108',        { type: 'AFTERMARKET', manufacturer: 'Toyota' },'Partslink TO → Toyota'],
    // UPCs and EANs — drop (null)
    ['816239024683',     null,                                            'UPC-12 dropped'],
    ['1234567890123',    null,                                            'EAN-13 dropped'],
    ['12345678901234',   null,                                            'EAN-14 dropped'],
    // Unknown Partslink prefix — falls through
    ['XX9999999',        undefined,                                       'Unknown 2-letter prefix falls through'],
    // Pure junk or unrecognised — falls through to aspect default
    ['random-string',    undefined,                                       'Unrecognised string falls through'],
    ['REPH288107',       undefined,                                       'Unknown aftermarket PN falls through (RE not in table)'],
    ['EVA11700063049',   undefined,                                       'Evan Fischer PN falls through'],
  ];

  it.each(cases)('classifyIdentifier(%s) → %j  [%s]', (input, expected) => {
    expect(classifyIdentifier(input)).toEqual(expected);
  });

  it('empty string returns undefined', () => {
    expect(classifyIdentifier('')).toBeUndefined();
    expect(classifyIdentifier('   ')).toBeUndefined();
  });
});

// ── mapEbayPosition — ambiguity logic ────────────────────────────────────────

describe('mapEbayPosition ambiguity', () => {
  it('"Left, Right" is ambiguous → undefined', () => {
    expect(mapEbayPosition('HEADLIGHT', 'Left, Right')).toBeUndefined();
  });

  it('"Front, Rear" is ambiguous → undefined', () => {
    expect(mapEbayPosition('BUMPER_COVER', 'Front, Rear')).toBeUndefined();
  });

  it('"Rear, Left" is NOT ambiguous → QUARTER_PANEL_LEFT', () => {
    expect(mapEbayPosition('QUARTER_PANEL', 'Rear, Left')).toBe('QUARTER_PANEL_LEFT');
  });

  it('"Front" alone → FRONT_BUMPER for BUMPER_COVER', () => {
    expect(mapEbayPosition('BUMPER_COVER', 'Front')).toBe('FRONT_BUMPER');
  });

  it('undefined placement → undefined', () => {
    expect(mapEbayPosition('HEADLIGHT', undefined)).toBeUndefined();
  });
});
