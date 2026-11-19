export const payment = {
  // Stripe setup
  userNotFound: 'User not found.',
  countryRequired:
    'Set your country on your profile before connecting payments.',
  countryNotSupported: "Stripe payments aren't available in your country yet.",
  stripeAccountNotFound:
    "You haven't connected a Stripe account yet. Set up payments first.",
  stripeAccountDisconnected:
    'Your Stripe account is no longer connected. Reconnect it from the payments page.',
  setupRequiredForDashboard:
    'Complete your Stripe setup before opening the Stripe dashboard.',
  setupRequiredForInvoices:
    'Complete your Stripe setup before issuing invoices.',
  setupRequiredForSubscriptions:
    'Complete your Stripe setup before creating subscriptions.',
  chargesNotEnabled:
    "Your Stripe account can't accept payments yet. Check your Stripe setup.",

  // Products
  productNotFound: 'Product not found.',
  productNotYours: 'You do not own this product.',
  productNotLinked: "This product isn't linked to Stripe yet. Create it again.",
  productNotSubscription: 'Choose a subscription product.',
  billingCadenceRequired:
    'Choose a billing cadence for a subscription product.',

  // Invoices
  invoiceNotFound: 'Invoice not found.',
  invoiceNoAccess: 'You cannot access this invoice.',
  invoiceNotLinked:
    'This invoice was never created on Stripe. Create a new one.',
  invoiceRecipientRequired:
    'Choose either a client or a guest email for this invoice.',
  guestNameRequired: "Add the guest's name.",
  invalidDueDate: 'Choose a valid due date.',
  dueDateInPast: 'Due date cannot be in the past.',
  invoiceNothingToUpdate:
    'Change the line items, due date or description before saving.',
  invoiceNotDraft:
    'Only draft invoices can be edited. Void this invoice and create a new one to make changes.',
  invoiceCannotSend:
    "{status, select, paid {This invoice is already paid, so there is nothing to send.} void {This invoice was voided, so it can't be sent.} other {This invoice can't be sent anymore.}}",
  invoiceNotReady:
    "This invoice isn't ready to send yet. Try again in a moment.",
  cannotVoidPaid: 'Cannot void a paid invoice. Issue a refund instead.',
  invoiceAlreadyPaid: 'This invoice is already paid.',
  invoiceCannotMarkPaid:
    "{status, select, void {This invoice was voided, so it can't be marked paid.} other {This invoice can't be marked paid anymore.}}",
  markPaidNeedsWaiver:
    'Before you can mark this invoice paid, the client has to agree to immediate access and waive their 14-day right of withdrawal. Ask them to pay it online.',
  markPaidFailed: 'Stripe could not mark this invoice paid. Try again.',

  clientNotFound:
    "This person isn't your client. Bill someone without an account by email.",

  // Paying an invoice (client)
  cannotPayInvoice: 'You cannot pay this invoice.',
  invoiceVoided: 'This invoice was voided and can no longer be paid.',
  waiverRequired:
    'To pay this invoice, agree to immediate access and waive your 14-day right of withdrawal.',
  invoiceNotSent:
    "This invoice hasn't been sent yet. Ask your coach to send it.",
  cardSetupFailed: "We couldn't start saving your card. Try again.",

  // Subscriptions
  subscriptionNotFound: 'Subscription not found.',
  subscriptionNotYours: 'You do not own this subscription.',
  subscriptionExists:
    'This client already has an active subscription to this plan. Cancel it first, or pick another plan.',
  subscriptionNotLinked:
    'This subscription was never set up on Stripe. Create it again.',

  // Refunds
  paymentNotFound: 'Payment not found.',
  paymentNotYours: 'You do not own this payment.',
  refundNotAllowed:
    "{status, select, pending {This payment hasn't gone through yet, so it can't be refunded.} failed {This payment failed, so there is nothing to refund.} refunded {This payment has already been refunded.} partially_refunded {This payment has already been partly refunded.} other {This payment can't be refunded.}}",
  refundWindowExpired: 'The {days}-day refund window has expired.',
  refundTooLarge: 'Refund amount exceeds the original payment.',
  refundBalanceTooLow:
    "Your Stripe balance can't cover this refund yet. Try again once the next payment has arrived.",
  notRefundableHere:
    "This payment wasn't made through Stripe, so it can't be refunded here.",
};
