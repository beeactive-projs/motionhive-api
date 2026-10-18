import type { Catalog } from '../..';

export const validation: Catalog['errors']['validation'] = {
  passwordsDoNotMatch: 'Parolele nu se potrivesc.',
  valuesDoNotMatch: 'Cele două valori nu se potrivesc.',
  weakPassword:
    'Parola trebuie să aibă cel puțin 8 caractere și să conțină o literă mare, o literă mică, o cifră și un caracter special (!@#$%^&*...).',
  dateInPast: 'Alege o dată și o oră din viitor.',
  invalidEmail: 'Introdu o adresă de email validă.',
  invalidCode: 'Introdu codul de 6 cifre din email.',
  invalidPhone:
    'Introdu numărul de telefon cu prefixul țării, de exemplu +40712345678.',
  invalidHandle:
    'Numele de utilizator poate avea între 3 și 40 de caractere (litere mici, cifre, „_” sau „-”) și trebuie să înceapă și să se termine cu o literă sau o cifră.',
  invalidPostalCode:
    'Introdu un cod poștal valid (între 2 și 20 de litere, cifre, spații sau cratime).',
  coachNameTooShort:
    'Numele antrenorului trebuie să aibă cel puțin 2 caractere.',
  noteTooLong: 'Mesajul poate avea cel mult 500 de caractere.',
  personalMessageTooLong:
    'Mesajul personal poate avea cel mult 500 de caractere.',
};
