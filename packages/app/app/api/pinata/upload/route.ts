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
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const tokenSymbol = formData.get("tokenSymbol") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "File must be an image" },
        { status: 400 }
      );
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File size must be less than 5MB" },
        { status: 400 }
      );
    }

    // Convert File to Blob for Pinata
    const bytes = await file.arrayBuffer();
    const blob = new Blob([bytes], { type: file.type });

    // Generate clean filename: SYMBOL-logo.ext
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const fileName = tokenSymbol
      ? `${tokenSymbol.toUpperCase()}-logo.${ext}`
      : `logo.${ext}`;

    // Create form data for Pinata legacy pinning API (public by default)
    const pinataFormData = new FormData();
    pinataFormData.append("file", blob, fileName);

    // Add metadata
    const metadata = {
      name: fileName,
      keyvalues: {
        type: "token-logo",
        symbol: tokenSymbol || "",
      },
    };
    pinataFormData.append("pinataMetadata", JSON.stringify(metadata));

    // Pin options - ensure CIDv1 for better compatibility
    const options = {
      cidVersion: 1,
    };
    pinataFormData.append("pinataOptions", JSON.stringify(options));

    // Upload using legacy pinning API - files are PUBLIC by default
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
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Failed to process upload" },
      { status: 500 }
    );
  }
}
