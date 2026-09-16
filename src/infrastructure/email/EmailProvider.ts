export interface SendOtpEmailParams {
  email: string;
  otp: string;
}

export interface EmailProvider {
  sendOtpEmail(params: SendOtpEmailParams): Promise<void>;
}
