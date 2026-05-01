import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { CustomerLoginDto } from './dto/customer-login.dto.js';
import { CustomerRegisterDto } from './dto/customer-register.dto.js';
import { UpdateStorefrontProfileDto } from './dto/update-storefront-profile.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        branchId: user.branchId,
      },
    };
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already exists');
    const hashed = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        password: hashed,
        role: dto.role,
        branchId: dto.branchId,
      },
    });
    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        branchId: user.branchId,
      },
    };
  }

  async customerLogin(dto: CustomerLoginDto) {
    const raw = dto.identifier.trim();
    const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let customer: Awaited<
      ReturnType<typeof this.prisma.customer.findFirst>
    > | null;
    if (emailLike.test(raw)) {
      const emailNorm = raw.toLowerCase();
      customer = await this.prisma.customer.findFirst({
        where: {
          OR: [{ email: emailNorm }, { email: raw }],
        },
      });
    } else {
      const phone = raw.replace(/\D/g, '');
      if (phone.length !== 11) {
        throw new UnauthorizedException('Invalid credentials');
      }
      customer = await this.prisma.customer.findFirst({
        where: { phone },
      });
    }
    if (
      !customer ||
      !customer.password ||
      !(await bcrypt.compare(dto.password, customer.password))
    ) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const payload = {
      sub: customer.id,
      email: customer.email,
      type: 'customer',
    };
    return {
      access_token: this.jwtService.sign(payload),
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      },
    };
  }

  async customerRegister(dto: CustomerRegisterDto) {
    const existing = await this.prisma.customer.findFirst({
      where: {
        OR: [{ email: dto.email }, { phone: dto.phone }],
      },
    });
    if (existing) {
      if (existing.email === dto.email) {
        throw new ConflictException('Email already exists');
      }
      throw new ConflictException('Phone number already registered');
    }
    const hashed = await bcrypt.hash(dto.password, 10);
    const customer = await this.prisma.customer.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        password: hashed,
      },
    });
    const payload = {
      sub: customer.id,
      email: customer.email,
      type: 'customer',
    };
    return {
      access_token: this.jwtService.sign(payload),
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      },
    };
  }

  async googleCustomerLogin(
    googleId: string,
    profile: { name: string; email: string },
  ) {
    let customer = await this.prisma.customer.findUnique({
      where: { googleId },
    });
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: { name: profile.name, email: profile.email, phone: '', googleId },
      });
    }
    const payload = {
      sub: customer.id,
      email: customer.email,
      type: 'customer',
    };
    return {
      access_token: this.jwtService.sign(payload),
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      },
    };
  }

  async getProfile(userId: number, tokenType?: string) {
    if (tokenType === 'customer') {
      const customer = await this.prisma.customer.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          address: true,
          division: true,
          district: true,
        },
      });
      if (!customer) throw new NotFoundException('Profile not found');
      return { ...customer, type: 'customer' as const };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        avatar: true,
        branchId: true,
      },
    });
    if (!user) throw new NotFoundException('Profile not found');
    return { ...user, type: 'staff' as const };
  }

  async updateStorefrontProfile(
    userId: number,
    tokenType: string | undefined,
    dto: UpdateStorefrontProfileDto,
  ) {
    if (tokenType !== 'customer') {
      throw new ForbiddenException('Only customer accounts can use this endpoint');
    }

    const existing = await this.prisma.customer.findUnique({
      where: { id: userId },
    });
    if (!existing) throw new NotFoundException('Customer not found');

    if (dto.email && dto.email !== existing.email) {
      const taken = await this.prisma.customer.findFirst({
        where: { email: dto.email, NOT: { id: userId } },
        select: { id: true },
      });
      if (taken) throw new BadRequestException('Email already in use');
    }

    if (dto.phone && dto.phone.trim() !== existing.phone) {
      const taken = await this.prisma.customer.findFirst({
        where: { phone: dto.phone.trim(), NOT: { id: userId } },
        select: { id: true },
      });
      if (taken) throw new BadRequestException('Phone already in use');
    }

    const updated = await this.prisma.customer.update({
      where: { id: userId },
      data: {
        ...(dto.name != null ? { name: dto.name } : {}),
        ...(dto.email != null ? { email: dto.email } : {}),
        ...(dto.phone != null ? { phone: dto.phone.trim() } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.division !== undefined ? { division: dto.division } : {}),
        ...(dto.district !== undefined ? { district: dto.district } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        division: true,
        district: true,
      },
    });
    return { ...updated, type: 'customer' as const };
  }
}
