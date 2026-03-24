import React, { useState, useEffect } from "react";
import axios from "axios";

const Part = ({ listing }) => {
    const [photos, setPhotos] = useState([]);

    useEffect(() => {}, []);
    return (
        <div>
            <p><span>Part Number: </span> {listing.partNumber}</p>
            <p><span>Part Type: </span> {listing.type}</p>
            <p><span>Condition: </span> {listing.condition}</p>
            <p><span>Quantity Available: </span> {listing.quantityAvailable}</p>
            <p><span>Price: </span> $ {listing.priceMinorMin} {listing.priceMinorMax ? `- ${listing.priceMinorMax} ` : ''}{listing.currency}</p>
            <p><span>Estimated Ship Time: </span> {listing.estimatedShipTimeHours}</p>
            <button onClick={onClick} />
        </div>
    )
}

export default Part;