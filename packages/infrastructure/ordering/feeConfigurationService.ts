import { isNull } from 'drizzle-orm';
import type { FeeConfigurationService } from '@interfaces/services/feeConfigurationService';
import { feeConfigurations } from '../db/src/schema/feeConfigurations';
import type { db as DbType } from '../db/src/db';

type Db = typeof DbType;

export class FeeConfigurationServiceImpl implements FeeConfigurationService {
    constructor(private readonly db: Db) {}

    async getCurrentFeePercent(): Promise<number> {
        const [row] = await this.db
            .select()
            .from(feeConfigurations)
            .where(isNull(feeConfigurations.effectiveUntil))
            .limit(1);

        if (!row) {
            throw new Error('No active fee configuration found');
        }

        return parseFloat(row.feePercent);
    }
}
