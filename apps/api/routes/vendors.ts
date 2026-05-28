import express, { type Request, type Response } from 'express';
import { db, vendors } from '@repo/db';
import { asc } from 'drizzle-orm';

const router = express.Router();

// GET /vendors — returns all active vendors for filter dropdowns and vendor panels
router.get('/', (_req: Request, res: Response) => {
    db.select({
        id: vendors.id,
        name: vendors.name,
        vendorType: vendors.vendorType,
        reliabilityScore: vendors.reliabilityScore,
        orderContactEmail: vendors.orderContactEmail,
    })
    .from(vendors)
    .orderBy(asc(vendors.name))
    .then((rows: any[]) => {
        return res.status(200).json({ vendors: rows });
    })
    .catch((err: Error) => {
        console.error('Failed to fetch vendors:', err);
        return res.status(500).json({ error: 'Error: ' + err.message });
    });
});

export default router;
