import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import ListingCard from "../components/ListingCard";
import axios from "axios";

const BASE_URL = process.env.baseURL ?? 'http://localhost:5050';

const Listings = () => {
    const [makesWithModels, setMakesWithModels] = useState({});
    const [categories, setCategories] = useState([]);
    const [positions, setPositions] = useState([]);
    const [constraints, setConstraints] = useState([]);
    const [years, setYears] = useState([]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [makesWithModels, years, categories, positions, constraints] = await Promise.all([
                    axios.get(`${BASE_URL}/fitments/makes-with-models`),
                    axios.get(`${BASE_URL}/fitments/years`),
                    axios.get(`${BASE_URL}/fitments/categories`),
                    axios.get(`${BASE_URL}/fitments/positions`),
                    axios.get(`${BASE_URL}/fitments/constraints`)
                ]);
                setMakesWithModels(makesWithModels.data);
                setYears(years.data);
                setCategories(categories.data);
                setPositions(positions.data);
                setConstraints(constraints.data);
            } catch (error) {
                console.error('Error fetching fitment data:', error);
            }
        };
        fetchData();
    }, []);
    
    const [isSearchFitment, setIsSearchByFitment] = useState(true);
    const [searchParams, setSearchParams] = useSearchParams();

    // These are what the query uses — read from URL
    const make = searchParams.get('make') ?? '';
    const model = searchParams.get('model') ?? '';
    const year = searchParams.get('year') ?? '';
    const category = searchParams.get('category') ?? '';
    const position = searchParams.get('position') ?? '';
    const constraint = searchParams.get('constraint') ?? '';
    const partNumber = searchParams.get('partNumber') ?? '';

    const [draftFitment, setDraftFitment] = useState({
        make: make, model: model, year: year,
        category: category, position: position, constraint: constraint
    });
    const [draftPartNumber, setDraftPartNumber] = useState({ partNumber });

    const fitmentQuery = useInfiniteQuery({
        queryKey: ['listings', 'fitments', { make: make, model: model, year: year, category: category, position: position, constraint: constraint }],
        queryFn: ({ pageParam }) => 
            axios.get(`${BASE_URL}/listings/by-fitment`, {
                params: {
                    make: make, model: model, year: year, category: category, position: position, constraint: constraint,
                    cursor: pageParam
                }
            }).then(r => r.data),
            getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.cursor : undefined,
            enabled: isSearchFitment && !!(make && model && year),
    });

    const partNumberQuery = useInfiniteQuery({
        queryKey: ['listings', 'partNumber', { partNumber }],
        queryFn: ({ pageParam }) => 
            axios.get(`${BASE_URL}/listings/by-part-number/${partNumber}`, {
                params: { cursor: pageParam }
            }).then(r => r.data),
        getNextPageParam: lastPage => lastPage.hasMore ? lastPage.cursor : undefined,
        enabled: !isSearchFitment && !!partNumber,
    });

    const activeQuery = isSearchFitment ? fitmentQuery : partNumberQuery;
    const listings = activeQuery.data?.pages.flatMap(p => p.listings) ?? [];
    const { fetchNextPage, hasNextPage, isFetchingNextPage } = activeQuery;


    const handleSearchByFitment = (e) => {
        e.preventDefault();
        setSearchParams({
            make: draftFitment.make, 
            model: draftFitment.model,
            year: draftFitment.year ?? "",
            category: draftFitment.category ?? "",
            position: draftFitment.position ?? "",
            constarint: draftFitment.constraint ?? "",
        });
    };

    const handleSearchByPartNumber = (e) => {
        e.preventDefault();
        setSearchParams({ partNumber: draftPartNumber.partNumber });
    };

    return (
        <div>
            <div>
                <button onClick={() => setIsSearchByFitment(true)} disabled={isSearchFitment}>Search by Fitment</button>
                <button onClick={() => setIsSearchByFitment(false)} disabled={!isSearchFitment}>Search by Part Number</button>
            </div>

            {isSearchFitment ? (
                <form onSubmit={handleSearchByFitment}>
                    <select value={draftFitment.make} onChange={(e) => setDraftFitment({ ...draftFitment, make: e.target.value })}>
                        <option value=''>Select a make</option>
                        {Object.keys(makesWithModels).map(make => <option key={make} value={make}>{make}</option>)}
                    </select>
                    <select value={draftFitment.model} disabled={!draftFitment.make} onChange={(e) => setDraftFitment({ ...draftFitment, model: e.target.value })}>
                        <option value=''>{draftFitment.make ? 'Select a model' : 'Select a make first'}</option>
                        {makesWithModels[draftFitment.make]?.map(model => <option key={model} value={model}>{model}</option>)}
                    </select>
                    <select value={draftFitment.year ?? ""} onChange={(e) => setDraftFitment({ ...draftFitment, year: e.target.value })}>
                        <option value=''>Select a year</option>
                        {years.map(year => <option key={year} value={year}>{year}</option>)}
                    </select>
                    <select value={draftFitment.category ?? ""} onChange={(e) => setDraftFitment({ ...draftFitment, category: e.target.value })}>
                        <option value=''>Select a category</option>
                        {categories.map(category => <option key={category} value={category}>{category}</option>)}
                    </select>
                    <select value={draftFitment.position ?? ""} onChange={(e) => setDraftFitment({ ...draftFitment, position: e.target.value })}>
                        <option value=''>Select a position</option>
                        {positions.map(position => <option key={position} value={position}>{position}</option>)}
                    </select>
                    <select value={draftFitment.constraint ?? ""} onChange={(e) => setDraftFitment({ ...draftFitment, constraint: e.target.value })}>
                        <option value=''>Select a constraint</option>
                        {constraints.map(constraint => <option key={constraint} value={constraint}>{constraint}</option>)}
                    </select>
                    <button type="submit" disabled={!draftFitment.make || !draftFitment.model || !draftFitment.year}>
                        Search
                    </button>
                </form>
            ) : (
                <form onSubmit={handleSearchByPartNumber}>
                    <label>Part Number: </label>
                    <input
                        type="text"
                        value={draftPartNumber.partNumber}
                        onChange={(e) => setDraftPartNumber({ ...draftPartNumber, partNumber: e.target.value })}
                    />
                    <button type="submit" disabled={!draftPartNumber.partNumber}>
                        Search
                    </button>
                </form>
            )}

            <div>
                {listings.map(listing => (
                    <ListingCard key={listing.id} listing={listing} onClick={() => {}} />
                ))}
            </div>

            {hasNextPage && (
                <button onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                    {isFetchingNextPage ? "Loading..." : "Load More"}
                </button>
            )}
        </div>
    );
};

export default Listings;