import type { Catalog } from '../..';

export const payment: Catalog['errors']['payment'] = {
  // Configurarea Stripe
  userNotFound: 'Nu am găsit utilizatorul.',
  countryRequired: 'Setează-ți țara în profil înainte să activezi plățile.',
  countryNotSupported:
    'Plățile prin Stripe nu sunt încă disponibile în țara ta.',
  stripeAccountNotFound:
    'Nu ai conectat încă un cont Stripe. Configurează mai întâi plățile.',
  stripeAccountDisconnected:
    'Contul tău Stripe nu mai este conectat. Reconectează-l din pagina de plăți.',
  setupRequiredForDashboard:
    'Finalizează configurarea Stripe înainte să deschizi panoul Stripe.',
  setupRequiredForInvoices:
    'Finalizează configurarea Stripe înainte să emiți facturi.',
  setupRequiredForSubscriptions:
    'Finalizează configurarea Stripe înainte să creezi abonamente.',
  chargesNotEnabled:
    'Contul tău Stripe nu poate primi încă plăți. Verifică configurarea Stripe.',

  // Produse
  productNotFound: 'Nu am găsit produsul.',
  productNotYours: 'Nu ai acces la acest produs.',
  productNotLinked: 'Produsul nu este încă legat de Stripe. Creează-l din nou.',
  productNotSubscription: 'Alege un produs de tip abonament.',
  billingCadenceRequired:
    'Alege frecvența facturării pentru un produs de tip abonament.',

  // Facturi
  invoiceNotFound: 'Nu am găsit factura.',
  invoiceNoAccess: 'Nu ai acces la această factură.',
  invoiceNotLinked:
    'Factura nu a fost creată niciodată în Stripe. Creează una nouă.',
  invoiceRecipientRequired:
    'Alege un client sau introdu adresa de email a unui client fără cont, nu amândouă.',
  guestNameRequired: 'Adaugă numele clientului care nu are cont.',
  invalidDueDate: 'Alege o scadență validă.',
  dueDateInPast: 'Scadența nu poate fi în trecut.',
  invoiceNothingToUpdate:
    'Nu ai modificat nimic. Schimbă articolele, scadența sau descrierea înainte să salvezi.',
  invoiceNotDraft:
    'Poți modifica doar facturile ciornă. Anulează factura și creează una nouă ca să faci modificări.',
  invoiceCannotSend:
    '{status, select, paid {Factura este deja plătită, așa că nu mai trebuie trimisă.} void {Factura a fost anulată, deci nu mai poate fi trimisă.} other {Factura nu mai poate fi trimisă.}}',
  invoiceNotReady:
    'Factura nu este încă gata de trimis. Încearcă din nou peste câteva clipe.',
  cannotVoidPaid:
    'Nu poți anula o factură plătită. Poți, în schimb, să rambursezi plata.',
  invoiceAlreadyPaid: 'Factura este deja plătită.',
  invoiceCannotMarkPaid:
    '{status, select, void {Factura a fost anulată, deci nu mai poate fi marcată ca plătită.} other {Factura nu mai poate fi marcată ca plătită.}}',
  markPaidNeedsWaiver:
    'Ca să marchezi factura ca plătită, clientul trebuie mai întâi să fie de acord cu accesul imediat la serviciu și să renunțe la dreptul de retragere de 14 zile. Roagă clientul să o plătească online.',
  markPaidFailed:
    'Stripe nu a putut marca factura ca plătită. Încearcă din nou.',

  clientNotFound:
    'Această persoană nu e clientul tău. Unei persoane fără cont îi poți trimite factura pe email.',

  // Plata unei facturi (client)
  cannotPayInvoice: 'Nu poți plăti această factură.',
  invoiceVoided: 'Factura a fost anulată și nu mai poate fi plătită.',
  waiverRequired:
    'Ca să plătești factura, trebuie să fii de acord cu accesul imediat la serviciu și să renunți la dreptul de retragere de 14 zile.',
  invoiceNotSent:
    'Factura nu a fost trimisă încă. Roagă-ți antrenorul să ți-o trimită.',
  cardSetupFailed: 'Nu am putut salva cardul. Încearcă din nou.',

  // Abonamente
  subscriptionNotFound: 'Nu am găsit abonamentul.',
  subscriptionNotYours: 'Nu ai acces la acest abonament.',
  subscriptionExists:
    'Clientul are deja un abonament activ la acest plan. Anulează mai întâi abonamentul existent sau alege alt plan.',
  subscriptionNotLinked:
    'Abonamentul nu a fost configurat niciodată în Stripe. Creează-l din nou.',

  // Rambursări
  paymentNotFound: 'Nu am găsit plata.',
  paymentNotYours: 'Nu ai acces la această plată.',
  refundNotAllowed:
    '{status, select, pending {Plata nu a fost încă procesată, așa că nu poate fi rambursată.} failed {Plata a eșuat, deci nu ai ce rambursa.} refunded {Plata a fost deja rambursată.} partially_refunded {Plata a fost deja rambursată parțial.} other {Plata nu poate fi rambursată.}}',
  refundWindowExpired:
    'Termenul de rambursare de {days, plural, one {# zi} few {# zile} other {# de zile}} a expirat.',
  refundTooLarge: 'Suma de rambursat depășește valoarea plății.',
  refundBalanceTooLow:
    'Soldul tău Stripe nu acoperă încă această rambursare. Încearcă din nou după ce intră următoarea plată.',
  notRefundableHere:
    'Plata nu a fost făcută prin Stripe, așa că nu o poți rambursa de aici.',
};
