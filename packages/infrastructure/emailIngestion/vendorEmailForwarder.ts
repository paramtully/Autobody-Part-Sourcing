/**
 * Forwards vendor emails to the customer's contact_email.
 * Implementation depends on the email provider (SES, Mailgun, etc.).
 */
export interface VendorEmailForwarder {
    forward(input: {
        toEmail: string;
        fromAddress: string;
        subject: string;
        body: string;
    }): Promise<void>;
}
