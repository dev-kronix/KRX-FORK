import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { MailerService } from '../mailer/mailer.service';
import { AllConfigType } from '../config/config.type';

describe('Dashboard email links', () => {
  const sendMail = jest.fn().mockResolvedValue(undefined);
  const config = {
    getOrThrow: (key: string) =>
      key === 'app.frontendDomain' ? 'https://krx.example' : '/app',
    get: () => 'KRX',
  };
  const service = new MailService(
    { sendMail } as unknown as MailerService,
    config as unknown as ConfigService<AllConfigType>,
  );
  beforeEach(() => sendMail.mockClear());
  it.each([
    ['userSignUp', 'confirm-email'],
    ['confirmNewEmail', 'confirm-new-email'],
    ['forgotPassword', 'reset-password'],
  ] as const)(
    '%s sends the token in the dashboard fragment',
    async (method, page) => {
      await service[method]({
        to: 'test@example.com',
        data: { hash: 'abc+/?=', tokenExpires: 123456 },
      });
      const url = new URL(sendMail.mock.calls[0][0].context.url);
      expect(url.pathname).toBe('/dashboard/');
      expect(url.search).toBe('');
      const [route, params] = url.hash.split('?');
      expect(route).toBe('#/' + page);
      expect(new URLSearchParams(params).get('hash')).toBe('abc+/?=');
      if (method === 'forgotPassword')
        expect(new URLSearchParams(params).get('expires')).toBe('123456');
    },
  );
});
