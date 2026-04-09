import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: { id: user.id, name: user.name, email: user.email, role: user.role, branchId: user.branchId },
    };
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already exists');
    const hashed = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { name: dto.name, email: dto.email, phone: dto.phone, password: hashed, role: dto.role, branchId: dto.branchId },
    });
    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: { id: user.id, name: user.name, email: user.email, role: user.role, branchId: user.branchId },
    };
  }

  async customerLogin(dto: LoginDto) {
    const customer = await this.prisma.customer.findFirst({ where: { email: dto.email } });
    if (!customer || !customer.password || !(await bcrypt.compare(dto.password, customer.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload = { sub: customer.id, email: customer.email, type: 'customer' };
    return {
      access_token: this.jwtService.sign(payload),
      customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone },
    };
  }

  async customerRegister(dto: { name: string; email: string; phone: string; password: string }) {
    const existing = await this.prisma.customer.findFirst({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already exists');
    const hashed = await bcrypt.hash(dto.password, 10);
    const customer = await this.prisma.customer.create({
      data: { name: dto.name, email: dto.email, phone: dto.phone, password: hashed },
    });
    const payload = { sub: customer.id, email: customer.email, type: 'customer' };
    return {
      access_token: this.jwtService.sign(payload),
      customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone },
    };
  }

  async googleCustomerLogin(googleId: string, profile: { name: string; email: string }) {
    let customer = await this.prisma.customer.findUnique({ where: { googleId } });
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: { name: profile.name, email: profile.email, phone: '', googleId },
      });
    }
    const payload = { sub: customer.id, email: customer.email, type: 'customer' };
    return {
      access_token: this.jwtService.sign(payload),
      customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone },
    };
  }

  async getProfile(userId: number) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true, role: true, avatar: true, branchId: true },
    });
  }
}
