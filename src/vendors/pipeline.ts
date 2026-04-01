// Vendor ingestion pipeline: fetch → validate → clean → upsert
// TODO: migrate from packages/infrastructure/vendorIngestion/

import { VendorInventoryClient } from "@/vendors/inventoryClient";
import { VendorRecord } from "./clients/vendorRecord";

interface IVendorPipeline {
    validateAndUpsertRecords(records: VendorRecord[]): Promise<void>;
    
    runIngestion(): Promise<void>;
}

export default class VendorPipeline implements IVendorPipeline {
    validateAndUpsertRecords(records: VendorRecord[]): Promise<void> {

    }
}


export {};

