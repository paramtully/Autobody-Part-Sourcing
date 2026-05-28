import { XMLParser } from 'fast-xml-parser';
import type { Fitment } from '../vendorRecord';

const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    isArray: (name) => name === 'Compatibility' || name === 'NameValueList',
});

/**
 * Calls the eBay Trading API GetItem with IncludeItemCompatibilityList to retrieve
 * the full vehicle fitment matrix for a listing. Returns [] on any failure so the
 * caller degrades gracefully to the Browse API compatibilityProperties.
 */
export async function fetchEbayItemCompatibilities(
    legacyItemId: string,
    token: string,
    apiUrl: string,
    siteId: string,
): Promise<Fitment[]> {
    const baseUrl = apiUrl.replace('api.sandbox.ebay.com', 'api.ebay.com'); // Trading API has no sandbox equivalent
    const xml = `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${legacyItemId}</ItemID><IncludeItemCompatibilityList>true</IncludeItemCompatibilityList><DetailLevel>ReturnAll</DetailLevel></GetItemRequest>`;

    let res: Response;
    try {
        res = await fetch(`${baseUrl}/ws/api.dll`, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml',
                'X-EBAY-API-CALL-NAME': 'GetItem',
                'X-EBAY-API-COMPATIBILITY-LEVEL': '1193',
                'X-EBAY-API-SITEID': siteId,
                'X-EBAY-API-IAF-TOKEN': token,
            },
            body: xml,
            signal: AbortSignal.timeout(10_000),
        });
    } catch {
        return [];
    }

    if (!res.ok) return [];

    try {
        const text = await res.text();
        const doc = parser.parse(text);
        const compatibilities: unknown[] = doc?.GetItemResponse?.Item?.ItemCompatibilityList?.Compatibility ?? [];

        return compatibilities.flatMap((compat: unknown) => {
            const nvList: Array<{ Name: string; Value: string }> =
                (compat as { NameValueList?: Array<{ Name: string; Value: string }> }).NameValueList ?? [];
            const get = (name: string) => nvList.find(nv => nv.Name === name)?.Value;
            const make  = get('Make');
            const model = get('Model');
            const yearStr = get('Year');
            const year = parseInt(yearStr ?? '', 10);
            if (!make || !model || isNaN(year)) return [];
            return [{ make, model, year, trim: get('Trim'), engine: get('Engine') }];
        });
    } catch {
        return [];
    }
}
