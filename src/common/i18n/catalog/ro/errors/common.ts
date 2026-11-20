import type { Catalog } from '../..';

export const common: Catalog['errors']['common'] = {
  badRequest: 'Nu am putut finaliza acțiunea. Încearcă din nou.',
  unauthorized: 'Te rugăm să te autentifici din nou.',
  forbidden: 'Nu ai permisiunea să faci asta.',
  notFound: 'Nu am găsit ce căutai.',
  conflict: 'Există deja ceva identic. Verifică și încearcă din nou.',
  tooLarge: 'Fișierul este prea mare.',
  resourceNotFound: 'Nu am găsit ce căutai.',
  notOwner: 'Nu ai permisiunea să faci asta.',
  invalidInput:
    'Unele câmpuri nu sunt completate corect. Verifică-le și încearcă din nou.',
  coachesOnly: 'Doar antrenorii pot face asta.',
  notWhileImpersonating:
    'Echipa de suport nu poate face asta când e conectată ca altcineva. Persoana trebuie să o facă singură.',
  noFile: 'Nu ai ales niciun fișier.',
  imageOnly: 'Poți încărca doar imagini.',
  fileTooLarge: 'Fișierul are mai mult de {maxMb} MB.',
  imageUploadFailed: 'Nu am putut încărca imaginea. Încearcă din nou.',
  imageNotUploaded:
    'Una dintre imagini nu s-a încărcat corect. Încarc-o din nou.',
  disposableEmail:
    'Nu acceptăm adrese de email temporare. Folosește adresa ta personală sau de serviciu.',
  emailCannotReceive:
    'Această adresă de email nu poate primi mesaje (domeniul nu are server de email). Verifică dacă ai scris-o corect.',
};
