import type { SupplierHotel } from '../domain/hotel.types';

type HotelSeed = Omit<SupplierHotel, 'city'>;

/**
 * Static mock inventory for both suppliers.
 * Each supplier now has 20 Delhi, 15 Mumbai, and 10 Bangalore offers.
 * The datasets include overlapping names at different prices and supplier-only hotels.
 */
const supplierAData: Record<string, HotelSeed[]> = {
  delhi: [
    { hotelId: 'a1', name: 'Holtin', price: 6000, commissionPct: 10 },
    { hotelId: 'a2', name: 'Radison', price: 5900, commissionPct: 13 },
    { hotelId: 'a3', name: 'Lemon Tree', price: 4200, commissionPct: 15 },
    { hotelId: 'a4', name: 'Taj Palace', price: 12000, commissionPct: 8 },
    { hotelId: 'a10', name: 'The Oberoi', price: 14300, commissionPct: 8 },
    { hotelId: 'a11', name: 'ITC Maurya', price: 11500, commissionPct: 10 },
    { hotelId: 'a12', name: 'The Imperial', price: 18000, commissionPct: 7 },
    { hotelId: 'a13', name: 'Hyatt Regency Delhi', price: 9800, commissionPct: 12 },
    { hotelId: 'a14', name: 'Le Meridien New Delhi', price: 9200, commissionPct: 11 },
    { hotelId: 'a15', name: 'The Park New Delhi', price: 7500, commissionPct: 14 },
    { hotelId: 'a16', name: 'Shangri-La Eros New Delhi', price: 10500, commissionPct: 9 },
    { hotelId: 'a17', name: 'JW Marriott New Delhi Aerocity', price: 13400, commissionPct: 8 },
    { hotelId: 'a18', name: 'The Claridges', price: 15500, commissionPct: 10 },
    { hotelId: 'a19', name: 'Taj Mahal Hotel', price: 17000, commissionPct: 7 },
    { hotelId: 'a20', name: 'Eros Hotel', price: 7900, commissionPct: 15 },
    { hotelId: 'a21', name: 'Roseate House', price: 12500, commissionPct: 9 },
    { hotelId: 'a22', name: 'Andaz Delhi', price: 16000, commissionPct: 8 },
    { hotelId: 'a23', name: 'The Suryaa', price: 6100, commissionPct: 16 },
    { hotelId: 'a24', name: 'Hotel Samrat', price: 5200, commissionPct: 18 },
    { hotelId: 'a25', name: 'Lemon Tree Premier', price: 6800, commissionPct: 13 },
  ],
  mumbai: [
    { hotelId: 'a5', name: 'Trident', price: 8500, commissionPct: 12 },
    { hotelId: 'a6', name: 'Oberoi', price: 14000, commissionPct: 7 },
    { hotelId: 'a7', name: 'Juhu Residency', price: 3900, commissionPct: 18 },
    { hotelId: 'a26', name: 'St. Regis Mumbai', price: 18000, commissionPct: 7 },
    { hotelId: 'a27', name: 'Taj Lands End', price: 14500, commissionPct: 9 },
    { hotelId: 'a28', name: 'ITC Maratha', price: 13000, commissionPct: 10 },
    { hotelId: 'a29', name: 'JW Marriott Mumbai Juhu', price: 19000, commissionPct: 8 },
    { hotelId: 'a30', name: 'Sofitel Mumbai BKC', price: 17000, commissionPct: 9 },
    { hotelId: 'a31', name: 'Four Seasons Hotel Mumbai', price: 22000, commissionPct: 6 },
    { hotelId: 'a32', name: 'The Leela Mumbai', price: 16500, commissionPct: 8 },
    { hotelId: 'a33', name: 'Grand Hyatt Mumbai', price: 15000, commissionPct: 10 },
    { hotelId: 'a34', name: 'Conrad Mumbai', price: 19000, commissionPct: 7 },
    { hotelId: 'a35', name: 'Vivanta Mumbai', price: 9800, commissionPct: 13 },
    { hotelId: 'a36', name: 'Radisson Blu Mumbai International Airport', price: 8500, commissionPct: 15 },
    { hotelId: 'a37', name: 'The Fern Goregaon', price: 6500, commissionPct: 17 },
  ],
  bangalore: [
    { hotelId: 'a8', name: 'Leela Palace', price: 9200, commissionPct: 10 },
    { hotelId: 'a9', name: 'ITC Gardenia', price: 7600, commissionPct: 11 },
    { hotelId: 'a38', name: 'Taj West End', price: 16000, commissionPct: 8 },
    { hotelId: 'a39', name: 'Shangri-La Bengaluru', price: 17200, commissionPct: 7 },
    { hotelId: 'a40', name: 'JW Marriott Bengaluru', price: 15500, commissionPct: 9 },
    { hotelId: 'a41', name: 'The Oberoi Bengaluru', price: 18000, commissionPct: 6 },
    { hotelId: 'a42', name: 'Conrad Bengaluru', price: 13500, commissionPct: 10 },
    { hotelId: 'a43', name: 'Vivanta Bengaluru', price: 8200, commissionPct: 14 },
    { hotelId: 'a44', name: 'Radisson Blu Atria Bengaluru', price: 7500, commissionPct: 15 },
    { hotelId: 'a45', name: 'The Ritz-Carlton, Bangalore', price: 21000, commissionPct: 6 },
  ],
};

const supplierBData: Record<string, HotelSeed[]> = {
  delhi: [
    { hotelId: 'b1', name: 'Holtin', price: 5340, commissionPct: 20 },
    { hotelId: 'b2', name: 'Radison', price: 6400, commissionPct: 12 },
    { hotelId: 'b3', name: 'The Lalit', price: 8100, commissionPct: 18 },
    { hotelId: 'b4', name: 'Taj Palace', price: 11500, commissionPct: 9 },
    { hotelId: 'b10', name: 'The Oberoi', price: 13800, commissionPct: 9 },
    { hotelId: 'b11', name: 'ITC Maurya', price: 11900, commissionPct: 8 },
    { hotelId: 'b12', name: 'The Imperial', price: 17500, commissionPct: 8 },
    { hotelId: 'b13', name: 'Hyatt Regency Delhi', price: 9200, commissionPct: 13 },
    { hotelId: 'b14', name: 'Le Meridien New Delhi', price: 9900, commissionPct: 10 },
    { hotelId: 'b15', name: 'The Park New Delhi', price: 7100, commissionPct: 16 },
    { hotelId: 'b16', name: 'Shangri-La Eros New Delhi', price: 11000, commissionPct: 8 },
    { hotelId: 'b17', name: 'JW Marriott New Delhi Aerocity', price: 12900, commissionPct: 9 },
    { hotelId: 'b18', name: 'The Claridges', price: 14900, commissionPct: 11 },
    { hotelId: 'b19', name: 'Taj Mahal Hotel', price: 16500, commissionPct: 8 },
    { hotelId: 'b20', name: 'Eros Hotel', price: 8400, commissionPct: 14 },
    { hotelId: 'b21', name: 'Roseate House', price: 11800, commissionPct: 10 },
    { hotelId: 'b22', name: 'Andaz Delhi', price: 15300, commissionPct: 9 },
    { hotelId: 'b23', name: 'Radisson Blu Plaza Delhi Airport', price: 7300, commissionPct: 16 },
    { hotelId: 'b24', name: 'The Grand New Delhi', price: 8900, commissionPct: 13 },
    { hotelId: 'b25', name: 'Pullman New Delhi Aerocity', price: 11200, commissionPct: 11 },
  ],
  mumbai: [
    { hotelId: 'b5', name: 'Trident', price: 8900, commissionPct: 10 },
    { hotelId: 'b6', name: 'Marrine', price: 5200, commissionPct: 16 },
    { hotelId: 'b7', name: 'Oberoi', price: 13500, commissionPct: 8 },
    { hotelId: 'b26', name: 'St. Regis Mumbai', price: 17500, commissionPct: 8 },
    { hotelId: 'b27', name: 'Taj Lands End', price: 15200, commissionPct: 8 },
    { hotelId: 'b28', name: 'ITC Maratha', price: 12500, commissionPct: 11 },
    { hotelId: 'b29', name: 'JW Marriott Mumbai Juhu', price: 18400, commissionPct: 9 },
    { hotelId: 'b30', name: 'Sofitel Mumbai BKC', price: 17800, commissionPct: 8 },
    { hotelId: 'b31', name: 'Four Seasons Hotel Mumbai', price: 21500, commissionPct: 7 },
    { hotelId: 'b32', name: 'The Leela Mumbai', price: 17000, commissionPct: 7 },
    { hotelId: 'b33', name: 'Grand Hyatt Mumbai', price: 14400, commissionPct: 11 },
    { hotelId: 'b34', name: 'Hotel Marine Plaza', price: 12500, commissionPct: 12 },
    { hotelId: 'b35', name: 'Holiday Inn Mumbai International Airport', price: 7800, commissionPct: 15 },
    { hotelId: 'b36', name: 'Novotel Mumbai Juhu Beach', price: 10500, commissionPct: 12 },
    { hotelId: 'b37', name: 'Courtyard by Marriott Mumbai', price: 11200, commissionPct: 10 },
  ],
  bangalore: [
    { hotelId: 'b8', name: 'Leela Palace', price: 9800, commissionPct: 9 },
    { hotelId: 'b9', name: 'Taj Vivanta', price: 6800, commissionPct: 14 },
    { hotelId: 'b38', name: 'Taj West End', price: 15400, commissionPct: 9 },
    { hotelId: 'b39', name: 'ITC Gardenia', price: 14900, commissionPct: 8 },
    { hotelId: 'b40', name: 'Shangri-La Bengaluru', price: 16800, commissionPct: 8 },
    { hotelId: 'b41', name: 'JW Marriott Bengaluru', price: 15900, commissionPct: 8 },
    { hotelId: 'b42', name: 'The Oberoi Bengaluru', price: 17600, commissionPct: 7 },
    { hotelId: 'b43', name: 'Taj Yeshwantpur', price: 9500, commissionPct: 12 },
    { hotelId: 'b44', name: 'Sheraton Grand Bengaluru Whitefield', price: 13000, commissionPct: 10 },
    { hotelId: 'b45', name: 'Courtyard by Marriott Bengaluru', price: 8400, commissionPct: 13 },
  ],
};

function getHotelsForCity(data: Record<string, HotelSeed[]>, city: string): SupplierHotel[] {
  const normalizedCity = city.trim().toLowerCase();
  return (data[normalizedCity] ?? []).map((hotel) => ({ ...hotel, city: normalizedCity }));
}

export function getSupplierAHotels(city: string): SupplierHotel[] {
  return getHotelsForCity(supplierAData, city);
}

export function getSupplierBHotels(city: string): SupplierHotel[] {
  return getHotelsForCity(supplierBData, city);
}
