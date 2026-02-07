import { NextRequest, NextResponse } from "next/server";

const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY;
const PINATA_GATEWAY = process.env.NEXT_PUBLIC_PINATA_GATEWAY || "https://gateway.pinata.cloud";
const PINATA_GATEWAY_KEY = process.env.NEXT_PUBLIC_PINATA_GATEWAY_KEY || "";

export async function POST(request: NextRequest) {
  if (!PINATA_API_KEY || !PINATA_SECRET_KEY) {
    return NextResponse.json(
      { error: "Pinata API keys not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { name, symbol, image, description, defaultMessage, recipientName, links } = body;

    if (!name || !symbol) {
      return NextResponse.json(
        { error: "Name and symbol are required" },
        { status: 400 }
      );
    }

    // Create metadata JSON
    const metadata: Record<string, unknown> = {
      name,
      symbol,
      image: image || "",
      description: description || "",
      defaultMessage: defaultMessage || "gm",
      ...(recipientName ? { recipientName } : {}),
      links: Array.isArray(links) ? links.filter((l: string) => l.trim() !== "") : [],
    };

    // Convert to blob
    const jsonBlob = new Blob([JSON.stringify(metadata, null, 2)], {
      type: "application/json",
    });

    // Generate clean filename: SYMBOL.json
    const fileName = `${symbol.toUpperCase()}.json`;

    // Create form data for Pinata
    const pinataFormData = new FormData();
    pinataFormData.append("file", jsonBlob, fileName);

    // Add Pinata metadata
    const pinataMetadata = {
      name: fileName,
      keyvalues: {
        type: "token-metadata",
        symbol: symbol,
      },
    };
    pinataFormData.append("pinataMetadata", JSON.stringify(pinataMetadata));

    // Pin options
    const options = {
      cidVersion: 1,
    };
    pinataFormData.append("pinataOptions", JSON.stringify(options));

    // Upload using legacy pinning API
    const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: {
        pinata_api_key: PINATA_API_KEY,
        pinata_secret_api_key: PINATA_SECRET_KEY,
      },
      body: pinataFormData,
    });

    const responseText = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        { error: `Pinata error: ${responseText}` },
        { status: 500 }
      );
    }

    const data = JSON.parse(responseText);
    const cid = data.IpfsHash;

    if (!cid) {
      return NextResponse.json(
        { error: "No CID returned from Pinata" },
        { status: 500 }
      );
    }

    const ipfsUrl = `ipfs://${cid}`;
    const baseGatewayUrl = `${PINATA_GATEWAY}/ipfs/${cid}`;
    const gatewayUrl = PINATA_GATEWAY_KEY ? `${baseGatewayUrl}?pinataGatewayToken=${PINATA_GATEWAY_KEY}` : baseGatewayUrl;

    return NextResponse.json({
      success: true,
      ipfsHash: cid,
      ipfsUrl,
      gatewayUrl,
    });
  } catch (error) {
    console.error("Metadata upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload metadata" },
      { status: 500 }
    );
  }
}
